import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readCheckpoint, writeCheckpoint } from '../electron/recovery-checkpoint.mjs';
const entry = revision => ({ scope: 'a'.repeat(64), generation: 'op_' + 'b'.repeat(32), revision, backup: { version: 2, queue: [{ id: 'pending-' + revision }], journal: [] } });
test('checkpoints retain the newest durable revision across reordered writes and process reopen', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-checkpoints-'));
  assert.equal((await readCheckpoint(dir, entry(1))).checkpoint, null);
  const results = await Promise.all([4, 2, 5, 1, 3].map(n => writeCheckpoint(dir, entry(n))));
  assert.ok(results.every(r => r.ok));
  assert.deepEqual((await readCheckpoint(dir, entry(1))).checkpoint, entry(5));
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, entry(1).scope + '.json'), 'utf8')), entry(5));
  assert.equal((await writeCheckpoint(dir, entry(5))).revision, 5);
  await assert.rejects(writeCheckpoint(dir, { ...entry(5), backup: { version: 2, queue: [], journal: [] } }));
  await assert.rejects(writeCheckpoint(dir, { ...entry(6), generation: 'op_' + 'c'.repeat(32) }));
  assert.deepEqual((await readCheckpoint(dir, entry(1))).checkpoint, entry(5));
  assert.equal((await readCheckpoint(dir, { scope: 'd'.repeat(64) })).checkpoint, null);
});
test('invalid or corrupt checkpoints fail without erasing the saved file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-checkpoints-'));
  for (const input of [{ ...entry(1), scope: '../escape' }, { ...entry(1), revision: 1.5 }, { ...entry(1), backup: {} }, { ...entry(1), padding: 'x'.repeat(4000000) }]) await assert.rejects(writeCheckpoint(dir, input));
  const file = path.join(dir, entry(1).scope + '.json');
  await writeFile(file, 'damaged');
  await assert.rejects(readCheckpoint(dir, entry(1)));
  await assert.rejects(writeCheckpoint(dir, entry(2)));
  assert.equal(await readFile(file, 'utf8'), 'damaged');
});
