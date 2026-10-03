import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preserveOfflineSale, readOfflineSales } from '../electron/offline-journal.mjs';
test('native journal keeps immutable complete records during concurrent retries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-journal-'));
  const record = { scope: 'a'.repeat(64), record: { v: 1, seq: 1, hash: 'b'.repeat(64), signature: 'c'.repeat(64) } };
  const result = await Promise.all(Array.from({ length: 5 }, () => preserveOfflineSale(dir, record)));
  assert.ok(result.every(r => r.ok));
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, record.scope, record.record.hash + '.json'), 'utf8')), record);
  assert.deepEqual((await readOfflineSales(dir, { scope: record.scope })).records, [record]);
  assert.deepEqual((await readOfflineSales(dir, { scope: "d".repeat(64) })).records, []);
  await assert.rejects(preserveOfflineSale(dir, { ...record, altered: true }));
  await assert.rejects(preserveOfflineSale(dir, { ...record, scope: '../escape' }));
});
