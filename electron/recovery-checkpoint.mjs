import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { checkpointReferences, checkpointPart, verifyCheckpointParts, verifyCheckpointSuccessor } from './checkpoint-fragments.mjs';
const writes = new Map();
export async function withCheckpointLock(directory, action) {
  const lock = path.resolve(directory), previous = writes.get(lock) || Promise.resolve();
  const work = previous.catch(() => {}).then(action);
  writes.set(lock, work);
  try { return await work; } finally { if (writes.get(lock) === work) writes.delete(lock); }
}
function location(directory, input) {
  if (!input || !/^[a-f0-9]{64}$/.test(input.scope || '')) throw new Error('Invalid recovery scope');
  return path.join(directory, input.scope + '.json');
}
export async function readCheckpoint(directory, input) {
  const file = location(directory, input);
  const checkpoint = await readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return { ok: true, checkpoint };
}
export async function writeCheckpoint(directory, input) {
  const file = location(directory, input), payload = JSON.stringify(input);
  if (!/^op_[a-f0-9]{32}$/.test(input.generation || '') || !Number.isSafeInteger(input.revision) || input.revision < 1 || input.backup?.version !== 2 || !Array.isArray(input.backup.queue) || !Array.isArray(input.backup.journal) || Buffer.byteLength(payload) > 4000000) throw new Error('Invalid recovery checkpoint');
  // The application has one main process. Serialize each scope, including
  // renderer retries. Parts and parents share one directory lock so validation,
  // parent publication and retirement cannot interleave with another write.
  return withCheckpointLock(directory, async () => {
    const { checkpoint: current } = await readCheckpoint(directory, input);
    if (current) {
      if (current.generation !== input.generation) throw new Error('Recovery generation changed');
      if (current.revision === input.revision && JSON.stringify(current) !== payload) throw new Error('Recovery revision reused');
      if (current.revision > input.revision) return { ok: true, generation: current.generation, revision: current.revision };
    }
    verifyCheckpointSuccessor(current, input);
    const refs = await verifyCheckpointParts(input, async scope => (await readCheckpoint(directory, { scope })).checkpoint);
    if (current && current.revision === input.revision) return { ok: true, generation: current.generation, revision: current.revision };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(payload); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      if (process.platform !== 'win32') { const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
      // Only superseded parts from the previous committed index are eligible.
      // Original sales live in a separate journal and are never considered.
      let retired = 0, cleanupPending = false, candidates = [];
      try { candidates = checkpointReferences(current || {}); } catch { cleanupPending = true; }
      const retained = new Set(refs.map(ref => ref.scope));
      for (const ref of candidates) {
        if (retained.has(ref.scope)) continue;
        try {
          const part = (await readCheckpoint(directory, { scope: ref.scope })).checkpoint;
          if (!part) continue;
          checkpointPart(current, ref, part);
          await unlink(location(directory, { scope: ref.scope })); retired++;
        } catch { cleanupPending = true; }
      }
      if (retired && process.platform !== 'win32') { try { const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } } catch { cleanupPending = true; } }
      return { ok: true, generation: input.generation, revision: input.revision, retired, cleanupPending };
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
}
