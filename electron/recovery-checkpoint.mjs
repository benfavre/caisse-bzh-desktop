import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const writes = new Map();
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
  // renderer retries, before reading and atomically replacing its snapshot.
  const previous = writes.get(file) || Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    const { checkpoint: current } = await readCheckpoint(directory, input);
    if (current) {
      if (current.generation !== input.generation) throw new Error('Recovery generation changed');
      if (current.revision === input.revision && JSON.stringify(current) !== payload) throw new Error('Recovery revision reused');
      if (current.revision >= input.revision) return { ok: true, generation: current.generation, revision: current.revision };
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(payload); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      if (process.platform !== 'win32') { const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
      return { ok: true, generation: input.generation, revision: input.revision };
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
  writes.set(file, work);
  try { return await work; } finally { if (writes.get(file) === work) writes.delete(file); }
}
