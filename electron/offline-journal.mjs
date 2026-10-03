import { mkdir, open, readFile, readdir, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function preserveOfflineSale(directory, input) {
  if (!input || !/^[a-f0-9]{64}$/.test(input.scope || '') || !/^[a-f0-9]{64}$/.test(input.record?.hash || '') ||
      !/^[a-f0-9]{64}$/.test(input.record?.signature || '') || input.record?.v !== 1 || !Number.isSafeInteger(input.record.seq) || input.record.seq < 1) throw new Error('Invalid offline record');
  const payload = JSON.stringify(input);
  if (Buffer.byteLength(payload) > 4000000) throw new Error('Offline record too large');
  const folder = path.join(directory, input.scope), file = path.join(folder, input.record.hash + '.json');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = path.join(folder, '.' + randomUUID() + '.tmp');
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(payload); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST' || await readFile(file, 'utf8') !== payload) throw error;
    }
    if (process.platform !== 'win32') { const dir = await open(folder, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
    return { ok: true, hash: input.record.hash };
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function readOfflineSales(directory, input) {
  if (!input || !/^[a-f0-9]{64}$/.test(input.scope || '') || (input.cursor && !/^[a-f0-9]{64}\.json$/.test(input.cursor))) throw new Error('Invalid recovery scope');
  const folder = path.join(directory, input.scope);
  const names = await readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const page = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name) && (!input.cursor || name > input.cursor)).sort().slice(0, 25);
  const records = [];
  for (const name of page) records.push(JSON.parse(await readFile(path.join(folder, name), 'utf8')));
  return { ok: true, records, cursor: page.length === 25 ? page[page.length - 1] : null };
}
