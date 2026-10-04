import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = () => { throw new Error('native_checkpoint_parts_invalid'); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function scope(value) {
  if (!value || typeof value.identity !== 'string' || !value.identity || value.identity.length > 200 || typeof value.shopId !== 'string' || !value.shopId || value.shopId.length > 200 || typeof value.training !== 'boolean') fail();
  return value;
}
function same(a, b) { return a && a.identity === b.identity && a.shopId === b.shopId && a.training === b.training; }
function fence(value) { return value?.version === 2 && Array.isArray(value.journal) && value.journal.length === 0 && Array.isArray(value.queue) && value.queue.length === 1 && Object.keys(value.queue[0] || {}).length === 1 && value.queue[0]?.op === 'checkpointFragmentsRequired'; }
export function checkpointReferences(parent) {
  const manifest = parent.backup?.checkpointFragments;
  if (!Object.hasOwn(parent.backup || {}, 'checkpointFragments')) return [];
  if (!manifest || typeof manifest !== 'object') fail();
  scope(parent.backup.context);
  if (!fence(parent.backup) || manifest.v !== 1 || !hex(manifest.hash) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 1048576 || manifest.bytes > 67108864 || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > 1024) fail();
  for (const ref of manifest.parts) {
    if (!ref || !hex(ref.hash) || ref.scope !== hash('caisse-checkpoint-fragment-v1:' + parent.scope + ':' + ref.hash) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > 393216) fail();
  }
  return manifest.parts;
}
export function checkpointPart(parent, ref, part) {
  const data = part?.backup?.checkpointPart;
  if (!part || part.scope !== ref.scope || part.generation !== 'op_' + ref.hash.slice(0,32) || part.revision !== 1 || !fence(part.backup) || !same(part.backup.context, parent.backup.context) || !data || data.v !== 1 || data.hash !== ref.hash || data.bytes !== ref.bytes || typeof data.text !== 'string' || data.text.length > 131072 || Buffer.byteLength(data.text) !== ref.bytes || hash(data.text) !== ref.hash) fail();
  return data.text;
}
export async function verifyCheckpointParts(parent, read) {
  const refs = checkpointReferences(parent);
  if (!refs.length) return refs;
  const texts = [], loaded = new Map(); let bytes = 0;
  for (const ref of refs) {
    if (!loaded.has(ref.scope)) loaded.set(ref.scope, checkpointPart(parent, ref, await read(ref.scope)));
    const text = loaded.get(ref.scope);
    if (Buffer.byteLength(text) !== ref.bytes) fail();
    bytes += ref.bytes; if (bytes > 67108864) fail(); texts.push(text);
  }
  const text = texts.join(''), manifest = parent.backup.checkpointFragments;
  if (bytes !== manifest.bytes || hash(text) !== manifest.hash) fail();
  const original = JSON.parse(text);
  if (!same(original?.context, parent.backup.context) || original?.version !== 2 || !Array.isArray(original.queue) || !Array.isArray(original.journal) || Object.hasOwn(original, 'checkpointFragments') || Object.hasOwn(original, 'checkpointPart')) fail();
  return refs;
}
export function verifyCheckpointSuccessor(previous, next) {
  if (!Object.hasOwn(previous?.backup || {}, 'checkpointFragments')) return;
  if (Object.hasOwn(next.backup || {}, 'checkpointPart') || !same(scope(next.backup?.context), scope(previous.backup.context))) fail();
}
export function checkpointRoot(parent) {
  scope(parent?.backup?.context);
  if (!hex(parent.scope) || !/^op_[a-f0-9]{32}$/.test(parent.generation || '') || !Number.isSafeInteger(parent.revision) || parent.revision < 1 || parent.backup.version !== 2 || !Array.isArray(parent.backup.queue) || !Array.isArray(parent.backup.journal) || Object.hasOwn(parent.backup, 'checkpointPart') || fence(parent.backup) && !Object.hasOwn(parent.backup, 'checkpointFragments')) fail();
}
export function orphanCheckpointReference(parent, part) {
  const data = part?.backup?.checkpointPart;
  // Ownership derives from the original root and content hash, never a filename
  // prefix or an age threshold. Unknown/corrupt records are not disposable.
  if (!data || !hex(data.hash) || part.scope !== hash('caisse-checkpoint-fragment-v1:' + parent.scope + ':' + data.hash)) return null;
  if (Object.hasOwn(part.backup, 'checkpointFragments') || !Number.isSafeInteger(data.bytes) || data.bytes < 1 || data.bytes > 393216) fail();
  const ref = { scope: part.scope, hash: data.hash, bytes: data.bytes };
  checkpointPart(parent, ref, part);
  return ref;
}
