import { lstat, readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { checkpointRoot, orphanCheckpointReference } from './checkpoint-fragments.mjs';

const session = randomUUID();
const fileFor = (directory, scope) => path.join(directory, scope + '.stage.json');
const validParent = value => value && typeof value.scope === 'string' && /^[a-f0-9]{64}$/.test(value.scope) && typeof value.generation === 'string' && /^op_[a-f0-9]{32}$/.test(value.generation) && Number.isSafeInteger(value.revision) && value.revision >= 1;

export function stagingParent(part, parent) {
  if (!validParent(parent)) throw new Error('Invalid checkpoint staging parent');
  const root = { ...parent, backup: { version: 2, context: part?.backup?.context, queue: [], journal: [] } };
  checkpointRoot(root);
  if (!orphanCheckpointReference(root, part)) throw new Error('Invalid checkpoint staging part');
  return { scope: parent.scope, generation: parent.generation, revision: parent.revision };
}

async function readStage(directory, scope) {
  try {
    const file = fileFor(directory, scope), info = await lstat(file);
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid checkpoint staging metadata');
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (value?.v !== 1 || value.scope !== scope || value.parent !== undefined && !validParent(value.parent) ||
        value.legacySession !== undefined && (typeof value.legacySession !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.legacySession)) ||
        value.parent === undefined && value.legacySession === undefined) throw new Error('Invalid checkpoint staging metadata');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Called under the checkpoint directory lock, before publishing a part. The
// sidecar is durable and separate from the immutable checkpoint payload.
export async function protectCheckpointPart(directory, part, parent) {
  const previous = await readStage(directory, part.scope), value = previous || { v: 1, scope: part.scope };
  const before = JSON.stringify(previous);
  if (parent) {
    if (value.parent && (value.parent.scope !== parent.scope || value.parent.generation !== parent.generation)) throw new Error('Checkpoint staging parent changed');
    value.parent = { ...parent, revision: Math.max(parent.revision, value.parent?.revision || 0) };
  } else value.legacySession = session;
  const payload = JSON.stringify(value);
  // Reading the same metadata is sufficient for retries: its original write
  // was fsynced before the part could be acknowledged.
  if (previous && payload === before) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, '.stage-' + randomUUID() + '.tmp');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(payload); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, fileFor(directory, part.scope));
    if (process.platform !== 'win32') { const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function mayRetireCheckpointPart(directory, parent, scope) {
  const value = await readStage(directory, scope);
  if (!value) return true; // A legacy part written before this process started.
  if (value.legacySession === session) return false;
  return !value.parent || value.parent.scope === parent.scope && value.parent.generation === parent.generation && value.parent.revision <= parent.revision;
}

export async function forgetCheckpointPart(directory, scope) {
  await unlink(fileFor(directory, scope)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
