import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptHtml } from '../electron/receipt.mjs';
test('the native receipt renders the immutable document and escapes its text', () => {
  const source = { seq: 1, hash: 'a'.repeat(64) };
  const doc = { version: 1, shopId: 'shop', training: true, copyNumber: 0, kind: 'sale', source, id: ['shop', 'training', 1, source.hash, 0].join(':'), blocks: [{ text: '<script>unsafe</script>', right: '12,00 €' }] };
  const html = receiptHtml(doc);
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('12,00 €'));
  assert.throws(() => receiptHtml({ ...doc, blocks: [{ text: 'x'.repeat(501) }] }));
});
