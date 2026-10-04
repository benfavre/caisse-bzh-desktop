import test from 'node:test';
import assert from 'node:assert/strict';
import {PeerSignalBridge,isPeerPage} from '../electron/peer-signal-bridge.mjs';
const tag='a'.repeat(32),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){let owner={},allowed=true;const carriers=[];const bridge=new PeerSignalBridge({authorize(event){if(!allowed||event!==owner)throw new Error('peer_signal_forbidden');return owner;},create(){const c={handle:'h'+carriers.length,tags:[],closed:false,async start(tags){this.tags=tags;if(this.gate)await this.gate.promise;return {ok:true,handle:this.handle,instance:'instance'};},configure(handle,tags){this.tags=tags;return {ok:true};},poll(){return {ok:true,peers:[],messages:[]};},async send(){return this.gate?this.gate.promise:{ok:true,queued:true};},async close(){this.closed=true;}};carriers.push(c);return c;}});return {bridge,carriers,get owner(){return owner;},forbid(){allowed=false;},replace(){owner={};}};}
test('native discovery only accepts exact trusted POS and kitchen pages',()=>{
 for(const url of ['https://caisse.bzh/app/pos','https://www.caisse.bzh:443/app/pos/kitchen/?shop=x'])assert.equal(isPeerPage(url),true);
 for(const url of ['https://caisse.bzh:444/app/pos','http://caisse.bzh/app/pos','https://caisse.bzh/auth/logout','https://caisse.bzh/app/pos/other','https://caisse.bzh.evil/app/pos','https://user@caisse.bzh/app/pos','file:///app/pos'])assert.equal(isPeerPage(url),false);
});
test('bridge configures only after empty startup and stale handles cannot stop a replacement',async()=>{
 const f=fixture();const a=await f.bridge.start(f.owner,{tags:[tag]}),first=f.carriers[0];assert.deepEqual(first.tags,[tag]);const b=await f.bridge.start(f.owner,{tags:[]});assert.equal(first.closed,true);
 assert.deepEqual(await f.bridge.call(f.owner,'stop',{handle:a.handle}),{ok:true,stale:true});assert.equal(f.carriers[1].closed,false);
 assert.deepEqual(await f.bridge.call(f.owner,'poll',{handle:b.handle}),{ok:true,peers:[],messages:[]});await f.bridge.invalidate();
});
test('document invalidation during startup never configures or returns the abandoned listener',async()=>{
 const f=fixture(),gate=deferred(),create=f.bridge.create;f.bridge.create=()=>{const c=create();c.gate=gate;return c;};
 const start=f.bridge.start(f.owner,{tags:[tag]});await new Promise(r=>setImmediate(r));const old=f.carriers[0];assert.deepEqual(old.tags,[]);
 await f.bridge.invalidate();gate.resolve();await assert.rejects(start,/session_changed/);assert.equal(old.closed,true);assert.deepEqual(old.tags,[]);assert.equal(f.bridge.current,null);
});
test('invalidation while replacing a listener cannot start work in the next document',async()=>{
 const f=fixture();await f.bridge.start(f.owner,{tags:[tag]});const gate=deferred();f.carriers[0].close=()=>gate.promise;
 const start=f.bridge.start(f.owner,{tags:[tag]});await f.bridge.invalidate();gate.resolve();await assert.rejects(start,/session_changed/);assert.equal(f.carriers.length,1);
});
test('sender ownership and post-await authorization reject stale native results',async()=>{
 const f=fixture(),x=await f.bridge.start(f.owner,{tags:[tag]}),gate=deferred();f.carriers[0].gate=gate;
 const sent=f.bridge.call(f.owner,'send',{handle:x.handle,instance:'remote',tag,nonce:'b'.repeat(24),ciphertext:'c'.repeat(24)});f.replace();gate.resolve({ok:true,queued:true});await assert.rejects(sent,/forbidden/);
 await assert.rejects(f.bridge.call(f.owner,'poll',{handle:x.handle}),/session_changed/);await f.bridge.invalidate();
});
test('requests are bounded and forbidden callers cannot start listeners',async()=>{
 const f=fixture(),x=await f.bridge.start(f.owner,{tags:[tag]}),gate=deferred();f.carriers[0].gate=gate;
 const calls=Array.from({length:8},()=>f.bridge.call(f.owner,'send',{handle:x.handle}));await assert.rejects(f.bridge.call(f.owner,'poll',{handle:x.handle}),/busy/);
 gate.resolve({ok:true});await Promise.all(calls);f.forbid();await assert.rejects(f.bridge.start(f.owner,{tags:[]}),/forbidden/);await f.bridge.invalidate();
});
