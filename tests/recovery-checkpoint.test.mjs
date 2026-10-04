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

const { createHash } = await import('node:crypto');
const digest = text => createHash('sha256').update(text).digest('hex');
function large(revision, label = 'first', scope = 'a'.repeat(64), shopId = 'shop') {
  const context = {identity:'account',shopId,training:false}, original = {version:2,context,queue:[{id:label}],journal:[],history:[(shopId==='shop'?'x':'y').repeat(1100000)]}, text=JSON.stringify(original), parts=[], refs=[];
  for(let start=0;start<text.length;start+=131072){
    const piece=text.slice(start,start+131072),hash=digest(piece),partScope=digest('caisse-checkpoint-fragment-v1:'+scope+':'+hash),bytes=Buffer.byteLength(piece);
    refs.push({scope:partScope,hash,bytes});parts.push({scope:partScope,generation:'op_'+hash.slice(0,32),revision:1,backup:{version:2,context,queue:[{op:'checkpointFragmentsRequired'}],journal:[],checkpointPart:{v:1,hash,bytes,text:piece}}});
  }
  return {parts,parent:{scope,generation:'op_'+'b'.repeat(32),revision,backup:{version:2,context,queue:[{op:'checkpointFragmentsRequired'}],journal:[],checkpointFragments:{v:1,hash:digest(text),bytes:Buffer.byteLength(text),parts:refs}}},original};
}
async function stage(dir, pack){for(const part of pack.parts)await writeCheckpoint(dir,part);}
test('a complete replacement retires only superseded checkpoint parts and incomplete writers cannot publish a broken index',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-checkpoint-pruning-')),a=large(1),b=large(2,'later'),foreign=large(1,'first','d'.repeat(64));
  await stage(dir,a);await writeCheckpoint(dir,a.parent);await stage(dir,foreign);await writeCheckpoint(dir,foreign.parent);
  const originalFile=JSON.parse(await readFile(path.join(dir,a.parent.scope+'.json'),'utf8'));
  await assert.rejects(writeCheckpoint(dir,b.parent));assert.deepEqual((await readCheckpoint(dir,a.parent)).checkpoint,originalFile);
  await stage(dir,b);const result=await writeCheckpoint(dir,b.parent);assert.ok(result.retired>0);
  assert.equal((await readCheckpoint(dir,{scope:a.parts[0].scope})).checkpoint,null);
  for(const part of b.parts)assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  for(const part of foreign.parts)assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  const stale={...a,parent:{...a.parent,revision:3}};await assert.rejects(writeCheckpoint(dir,stale.parent));assert.deepEqual((await readCheckpoint(dir,b.parent)).checkpoint,b.parent);
  await stage(dir,stale);await writeCheckpoint(dir,stale.parent);assert.deepEqual((await readCheckpoint(dir,a.parent)).checkpoint,stale.parent);
  await assert.rejects(writeCheckpoint(dir,{...entry(4),backup:{version:2,queue:[],journal:[]}}));
  assert.deepEqual((await readCheckpoint(dir,a.parent)).checkpoint,stale.parent);
  const small={...entry(4),backup:{version:2,context:a.original.context,queue:[{id:'retained'}],journal:[]}};await writeCheckpoint(dir,small);
  for(const part of a.parts)assert.equal((await readCheckpoint(dir,part)).checkpoint,null);
});
test('racing parent commits validate retained parts again after a competing cleanup',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-checkpoint-race-')),a=large(1),b=large(2,'later');
  await stage(dir,a);await writeCheckpoint(dir,a.parent);await stage(dir,b);await writeCheckpoint(dir,b.parent);
  const nextA={...a.parent,revision:3},nextB={...b.parent,revision:4};await stage(dir,a);await stage(dir,b);
  const results=await Promise.allSettled([writeCheckpoint(dir,nextA),writeCheckpoint(dir,nextB)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.deepEqual((await readCheckpoint(dir,nextA)).checkpoint,nextA);
  await stage(dir,b);await writeCheckpoint(dir,nextB);assert.deepEqual((await readCheckpoint(dir,nextB)).checkpoint,nextB);
});
test('altered content, reference order and scope cannot replace a complete native backup',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-checkpoint-proof-')),pack=large(1);await stage(dir,pack);await writeCheckpoint(dir,pack.parent);
  const foreign=large(2,'first',pack.parent.scope,'other');await stage(dir,foreign);await assert.rejects(writeCheckpoint(dir,foreign.parent));
  for (const key of ['checkpointFragments','checkpointPart']) for (const value of [null,false,0]) {
    const malformed={...entry(2),backup:{version:2,context:pack.original.context,queue:[],journal:[],[key]:value}};
    await assert.rejects(writeCheckpoint(dir,malformed));
    assert.deepEqual((await readCheckpoint(dir,pack.parent)).checkpoint,pack.parent);
  }
  const reversed=structuredClone(pack.parent);reversed.revision=2;reversed.backup.checkpointFragments.parts.reverse();await assert.rejects(writeCheckpoint(dir,reversed));
  const wrong=structuredClone(pack.parent);wrong.revision=2;wrong.backup.context.shopId='other';await assert.rejects(writeCheckpoint(dir,wrong));
  const part=structuredClone(pack.parts[0]);part.backup.checkpointPart.text+='altered';await writeFile(path.join(dir,part.scope+'.json'),JSON.stringify(part));
  await assert.rejects(writeCheckpoint(dir,{...pack.parent,revision:2}));assert.deepEqual((await readCheckpoint(dir,pack.parent)).checkpoint,pack.parent);
});
