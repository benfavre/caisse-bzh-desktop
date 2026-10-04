import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readCheckpoint, writeCheckpoint, stageCheckpoint, withCheckpointLock } from '../electron/recovery-checkpoint.mjs';
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

const { createHash, randomUUID } = await import('node:crypto');
const digest = text => createHash('sha256').update(text).digest('hex');
function large(revision, label = 'first', scope = 'a'.repeat(64), shopId = 'shop') {
  const context = {identity:'account',shopId,training:false}, original = {version:2,context,queue:[{id:label}],journal:[],history:[(shopId==='shop'?'x':'y').repeat(1100000)]}, text=JSON.stringify(original), parts=[], refs=[];
  for(let start=0;start<text.length;start+=131072){
    const piece=text.slice(start,start+131072),hash=digest(piece),partScope=digest('caisse-checkpoint-fragment-v1:'+scope+':'+hash),bytes=Buffer.byteLength(piece);
    refs.push({scope:partScope,hash,bytes});parts.push({scope:partScope,generation:'op_'+hash.slice(0,32),revision:1,backup:{version:2,context,queue:[{op:'checkpointFragmentsRequired'}],journal:[],checkpointPart:{v:1,hash,bytes,text:piece}}});
  }
  return {parts,parent:{scope,generation:'op_'+'b'.repeat(32),revision,backup:{version:2,context,queue:[{op:'checkpointFragmentsRequired'}],journal:[],checkpointFragments:{v:1,hash:digest(text),bytes:Buffer.byteLength(text),parts:refs}}},original};
}
async function stagePart(dir, checkpoint, parent){return stageCheckpoint(dir,{checkpoint,parent});}
async function stage(dir, pack){for(const part of pack.parts)await stagePart(dir,part,pack.parent);}
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
  const nextA={...a.parent,revision:3},nextB={...b.parent,revision:4};await stage(dir,{...a,parent:nextA});await stage(dir,{...b,parent:nextB});
  const results=await Promise.allSettled([writeCheckpoint(dir,nextA),writeCheckpoint(dir,nextB)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'fulfilled');assert.deepEqual((await readCheckpoint(dir,nextB)).checkpoint,nextB);
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

const { collectCheckpointBatch, CheckpointCollector } = await import('../electron/checkpoint-cleanup.mjs');
function orphan(parent, text) {
  const hash=digest(text),scope=digest('caisse-checkpoint-fragment-v1:'+parent.scope+':'+hash);
  return {scope,generation:'op_'+hash.slice(0,32),revision:1,backup:{version:2,context:parent.backup.context,queue:[{op:'checkpointFragmentsRequired'}],journal:[],checkpointPart:{v:1,hash,bytes:Buffer.byteLength(text),text}}};
}
async function collectAll(dir,scope,scan={}) {
  let retired=0,temporaryRetired=0,pending=false,steps=0;
  while(true){const r=await collectCheckpointBatch(dir,scope,scan);assert.ok(r.examined<=8);retired+=r.retired;temporaryRetired+=r.temporaryRetired;pending||=r.cleanupPending;steps++;if(!r.more)return {retired,temporaryRetired,pending,steps};assert.ok(steps<100);}
}
test('bounded orphan collection preserves committed, foreign, malformed and unknown records',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-orphan-scope-')),a=large(1),abandoned=large(2,'abandoned'),foreign=large(1,'foreign','d'.repeat(64));
  await stage(dir,a);await writeCheckpoint(dir,a.parent);await stage(dir,{...abandoned,parent:{...abandoned.parent,revision:1}});await stage(dir,foreign);await writeCheckpoint(dir,foreign.parent);
  const stray=Array.from({length:22},(_,i)=>orphan(a.parent,'orphan '+i));for(const part of stray)await stagePart(dir,part,a.parent);
  const corrupt=orphan(a.parent,'damaged');corrupt.backup.checkpointPart.text='changed';await writeCheckpoint(dir,corrupt);
  const unknown=path.join(dir,'e'.repeat(64)+'.json');await writeFile(unknown,'{broken');
  const result=await collectAll(dir,a.parent.scope);assert.ok(result.steps>1);assert.ok(result.retired>=23);assert.equal(result.pending,true);
  for(const part of [...a.parts,...foreign.parts])assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  for(const part of stray)assert.equal((await readCheckpoint(dir,part)).checkpoint,null);
  assert.deepEqual((await readCheckpoint(dir,corrupt)).checkpoint,corrupt);assert.equal(await readFile(unknown,'utf8'),'{broken');
  assert.deepEqual((await readCheckpoint(dir,a.parent)).checkpoint,a.parent);assert.deepEqual((await readCheckpoint(dir,foreign.parent)).checkpoint,foreign.parent);
});
test('cleanup between every staged fragment and retry cannot interrupt a newer parent',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-orphan-writer-')),a=large(1),b=large(2,'next');await stage(dir,a);await writeCheckpoint(dir,a.parent);
  for(const part of b.parts){await stagePart(dir,part,b.parent);await collectAll(dir,a.parent.scope);assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);}
  for(const part of b.parts){await stagePart(dir,part,a.parent);await collectAll(dir,a.parent.scope);assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);}
  assert.deepEqual((await readCheckpoint(dir,a.parent)).checkpoint,a.parent);
  await writeCheckpoint(dir,b.parent);await collectAll(dir,b.parent.scope);
  for(const part of b.parts)assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
});
test('cleanup verifies a changed parent again and refuses incomplete current backups',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-orphan-proof-')),a=large(1),b=large(2,'next');await stage(dir,a);await writeCheckpoint(dir,a.parent);
  for(let i=0;i<25;i++)await stagePart(dir,orphan(a.parent,'unused '+i),a.parent);
  const scan={};assert.equal((await collectCheckpointBatch(dir,a.parent.scope,scan)).more,true);
  await stage(dir,b);await writeCheckpoint(dir,b.parent);await collectAll(dir,b.parent.scope,scan);
  for(const part of b.parts)assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  const leftover=orphan(b.parent,'keep on damaged backup');await writeCheckpoint(dir,leftover);
  const damaged=structuredClone(b.parts[0]);damaged.backup.checkpointPart.text+='!';await writeFile(path.join(dir,damaged.scope+'.json'),JSON.stringify(damaged));
  await assert.rejects(collectCheckpointBatch(dir,b.parent.scope,{}));assert.deepEqual((await readCheckpoint(dir,leftover)).checkpoint,leftover);
});
test('a compact root and process reopen collect old interrupted-cleanup parts',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-orphan-compact-')),a=large(1);await stage(dir,a);await writeCheckpoint(dir,a.parent);
  const compact={...entry(2),backup:{version:2,context:a.original.context,queue:[{id:'original pending'}],journal:[]}};await writeCheckpoint(dir,compact);
  // Recreate durable leftovers from a process interrupted after parent rename.
  await stage(dir,a);const result=await collectAll(dir,compact.scope,{});assert.ok(result.retired>0);
  assert.deepEqual((await readCheckpoint(dir,compact)).checkpoint,compact);for(const part of a.parts)assert.equal((await readCheckpoint(dir,part)).checkpoint,null);
});
test('background collector progresses without another sale and closes cleanly',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-orphan-background-')),parent={...entry(1),backup:{version:2,context:{identity:'account',shopId:'shop',training:false},queue:[{id:'pending'}],journal:[]}};
  await writeCheckpoint(dir,parent);const part=orphan(parent,'abandoned background');await stagePart(dir,part,parent);
  const messages=[],collector=new CheckpointCollector(dir,message=>messages.push(message));collector.schedule(parent.scope);collector.schedule(parent.scope);
  try{const until=Date.now()+5000;while((await readCheckpoint(dir,part)).checkpoint&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,25));assert.equal((await readCheckpoint(dir,part)).checkpoint,null);assert.deepEqual((await readCheckpoint(dir,parent)).checkpoint,parent);assert.deepEqual(messages,[]);}finally{collector.close();}
});

const temporaryFile = dir => path.join(dir, '.' + randomUUID() + '.tmp');
test('interrupted temporary copies are collected only after identical root and retained parts are committed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-temporary-recovery-')), first = large(1), next = large(2, 'later');
  await stage(dir, first); await writeCheckpoint(dir, first.parent); await stage(dir, next);
  // A previous process synced this candidate but died before publishing it.
  const pendingRoot = temporaryFile(dir);
  await writeFile(pendingRoot, JSON.stringify(next.parent));
  assert.equal((await collectAll(dir, first.parent.scope)).temporaryRetired, 0);
  assert.equal(await readFile(pendingRoot, 'utf8'), JSON.stringify(next.parent));
  // Normal retry recopies any orphan parts, commits, then permits cleanup.
  await stage(dir, next); await writeCheckpoint(dir, next.parent);
  const copies = [pendingRoot];
  for (let i = 0; i < 20; i++) {
    const file = temporaryFile(dir); copies.push(file);
    await writeFile(file, JSON.stringify(i % 2 ? next.parent : next.parts[0]));
  }
  const result = await collectAll(dir, next.parent.scope);
  assert.equal(result.temporaryRetired, copies.length); assert.equal(result.pending, false); assert.ok(result.steps > 1);
  for (const file of copies) await assert.rejects(access(file), { code: 'ENOENT' });
  assert.deepEqual((await readCheckpoint(dir, next.parent)).checkpoint, next.parent);
  for (const part of next.parts) assert.deepEqual((await readCheckpoint(dir, part)).checkpoint, part);
});

test('temporary cleanup preserves unique, damaged, oversized, foreign and unknown files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-temporary-preserve-')), a = large(1), foreign = large(1, 'foreign', 'd'.repeat(64));
  a.parent.diagnostic = '\ufffd';
  await stage(dir, a); await writeCheckpoint(dir, a.parent); await stage(dir, foreign); await writeCheckpoint(dir, foreign.parent);
  const original = new Map();
  for (const text of [JSON.stringify(large(2, 'unique pending').parent), JSON.stringify(foreign.parent), JSON.stringify(foreign.parts[0]), '{partial', 'x'.repeat(4000001), JSON.stringify({ ...a.parts[0], altered: true })]) {
    const file = temporaryFile(dir); original.set(file, text); await writeFile(file, text);
  }
  // Invalid UTF-8 must not compare equal after replacement-character decoding.
  const invalid = temporaryFile(dir), bytes = Buffer.from(JSON.stringify(a.parent));
  const offset = bytes.indexOf(Buffer.from('\ufffd')); assert.ok(offset >= 0);
  // A truncated four-byte sequence decodes to one replacement character,
  // exactly like the valid three-byte U+FFFD, without changing file length.
  Buffer.from([0xf0, 0x90, 0x80]).copy(bytes, offset);
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), a.parent);
  await writeFile(invalid, bytes);
  const unknown = path.join(dir, '.not-a-writer-id.tmp'); original.set(unknown, JSON.stringify(a.parent)); await writeFile(unknown, original.get(unknown));
  const directory = temporaryFile(dir); await mkdir(directory);
  const result = await collectAll(dir, a.parent.scope);
  assert.equal(result.temporaryRetired, 0); assert.equal(result.pending, true);
  for (const [file, text] of original) assert.equal(await readFile(file, 'utf8'), text);
  assert.deepEqual(await readFile(invalid), bytes); await access(directory);
  assert.deepEqual((await readCheckpoint(dir, a.parent)).checkpoint, a.parent);
});

test('temporary duplicate cleanup revalidates complete recovery even with an unchanged cached parent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-temporary-proof-')), a = large(1), scan = {};
  await stage(dir, a); await writeCheckpoint(dir, a.parent); await collectAll(dir, a.parent.scope, scan);
  const rootCopy = temporaryFile(dir), partCopy = temporaryFile(dir);
  await writeFile(rootCopy, JSON.stringify(a.parent)); await writeFile(partCopy, JSON.stringify(a.parts[0]));
  const damaged = path.join(dir, a.parts.at(-1).scope + '.json'), text = await readFile(damaged, 'utf8');
  await writeFile(damaged, '{damaged');
  const result = await collectAll(dir, a.parent.scope, scan);
  assert.equal(result.temporaryRetired, 0); assert.equal(result.pending, true);
  assert.equal(await readFile(rootCopy, 'utf8'), JSON.stringify(a.parent));
  assert.equal(await readFile(partCopy, 'utf8'), JSON.stringify(a.parts[0]));
  await writeFile(damaged, text);
  assert.equal((await collectAll(dir, a.parent.scope, scan)).temporaryRetired, 2);
});

test('temporary cleanup waits for the writer directory lock before examining a live write', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caisse-temporary-lock-')), a = large(1);
  await stage(dir, a); await writeCheckpoint(dir, a.parent);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const file = temporaryFile(dir);
  const writing = withCheckpointLock(dir, async () => { await writeFile(file, JSON.stringify(a.parent)); entered(); await gate; });
  await ready;
  let finished = false;
  const collecting = collectAll(dir, a.parent.scope).then(result => { finished = true; return result; });
  try { await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(finished, false); await access(file); }
  finally { release(); }
  await writing; assert.equal((await collecting).temporaryRetired, 1);
});

const { execFileSync } = await import('node:child_process');
function collectInNewProcess(dir,scope){
  const module=new URL('../electron/checkpoint-cleanup.mjs',import.meta.url).href;
  const source=`import {collectCheckpointBatch} from ${JSON.stringify(module)}; const scan={}; while((await collectCheckpointBatch(process.argv[1],process.argv[2],scan)).more){}`;
  execFileSync(process.execPath,['--input-type=module','-e',source,dir,scope],{timeout:10000});
}
test('durable revision fences survive process replacement while old-client parts wait until their writer exits',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-staging-process-')),a=large(1),b=large(2,'new writer');await stage(dir,a);await writeCheckpoint(dir,a.parent);await stage(dir,b);
  const legacy=orphan(a.parent,'old-client staging');await writeCheckpoint(dir,legacy);
  await collectAll(dir,a.parent.scope);assert.deepEqual((await readCheckpoint(dir,legacy)).checkpoint,legacy);
  collectInNewProcess(dir,a.parent.scope);
  assert.equal((await readCheckpoint(dir,legacy)).checkpoint,null);
  for(const part of b.parts)assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  await writeCheckpoint(dir,b.parent);collectInNewProcess(dir,b.parent.scope);
  for(const part of b.parts)assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
});
test('invalid staging metadata and foreign parents cannot retire or rewrite an original part',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'caisse-staging-invalid-')),a=large(1),b=large(2,'future');await stage(dir,a);await writeCheckpoint(dir,a.parent);
  const part=b.parts[0];await stagePart(dir,part,b.parent);
  for(const parent of [{...b.parent,scope:'d'.repeat(64)},{...b.parent,revision:0},{...b.parent,revision:1.5},{...b.parent,generation:'op_'+'f'.repeat(32)}])await assert.rejects(stagePart(dir,part,parent));
  assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  const changed=structuredClone(part);changed.backup.checkpointPart.text+='!';await assert.rejects(stagePart(dir,changed,b.parent));
  await writeFile(path.join(dir,part.scope+'.stage.json'),'{damaged');
  assert.equal((await collectAll(dir,a.parent.scope)).pending,true);
  assert.deepEqual((await readCheckpoint(dir,part)).checkpoint,part);
  assert.deepEqual((await readCheckpoint(dir,a.parent)).checkpoint,a.parent);
});
