import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OfflineRetry } from '../electron/offline-retry.mjs';
function fixture() {
  let waiting=true, online=true, recovered=0, serial=0;
  const intervals=new Map(),timeouts=new Map(),requests=[];
  const retry=new OfflineRetry({isWaiting:()=>waiting,online:()=>online,recover:()=>{recovered++;},
    request(){const req=new EventEmitter();req.aborted=false;req.end=()=>{};req.abort=()=>{req.aborted=true;req.emit('abort');};requests.push(req);return req;},
    timers:{setInterval(fn){const id=++serial;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);},setTimeout(fn){const id=++serial;timeouts.set(id,fn);return id;},clearTimeout(id){timeouts.delete(id);}}});
  return {retry,requests,intervals,timeouts,get recovered(){return recovered;},waiting(value){waiting=value;},online(value){online=value;},tick(){for(const fn of [...intervals.values()])fn();},expire(){for(const fn of [...timeouts.values()])fn();},reply(index,status=200){const res=new EventEmitter();res.statusCode=status;requests[index].emit('response',res);res.emit('end');}};
}
test('leaving the offline document cancels its timer, request and delayed successful response',()=>{
  const f=fixture();f.retry.start();f.tick();const oldTick=[...f.intervals.values()][0];
  f.waiting(false);f.retry.stop();assert.equal(f.requests[0].aborted,true);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);
  oldTick();f.reply(0);assert.equal(f.recovered,0);assert.equal(f.requests.length,1);
});
test('late replies from a replaced offline session cannot navigate or cancel its newer request',()=>{
  const f=fixture();f.retry.start();f.tick();const oldTick=[...f.intervals.values()][0];f.retry.start();oldTick();assert.equal(f.requests.length,1);f.tick();f.reply(0);
  assert.equal(f.recovered,0);assert.equal(f.retry.pending,f.requests[1]);assert.equal(f.timeouts.size,1);
  f.reply(1);assert.equal(f.recovered,1);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);f.reply(1);assert.equal(f.recovered,1);
});
test('current offline success recovers once, but a changed document never navigates even without a stop event',()=>{
  for(const waiting of [true,false]){const f=fixture();f.retry.start();f.tick();f.waiting(waiting);f.reply(0);assert.equal(f.recovered,waiting?1:0);assert.equal(f.intervals.size,0);}
});
test('offline probes are bounded, do not overlap and ignore replies after their deadline',()=>{
  const f=fixture();f.retry.start();f.tick();f.tick();assert.equal(f.requests.length,1);f.expire();assert.equal(f.requests[0].aborted,true);
  f.tick();assert.equal(f.requests.length,2);f.reply(0);assert.equal(f.recovered,0);assert.equal(f.retry.pending,f.requests[1]);f.reply(1);assert.equal(f.recovered,1);
});
test('unavailable network, errors and server failure retain the offline page and permit a later probe',()=>{
  const f=fixture();f.retry.start();f.online(false);f.tick();assert.equal(f.requests.length,0);f.online(true);f.tick();f.reply(0,503);assert.equal(f.recovered,0);
  f.tick();f.requests[1].emit('error',new Error('Network lost'));assert.equal(f.timeouts.size,0);f.tick();f.reply(2);assert.equal(f.recovered,1);
});
test('normal documents cannot arm retry polling; losing the offline document stops an idle timer',()=>{
  const f=fixture();f.waiting(false);f.retry.start();assert.equal(f.intervals.size,0);f.waiting(true);f.retry.start();f.waiting(false);f.tick();assert.equal(f.requests.length,0);assert.equal(f.intervals.size,0);
});
test('synchronous probe failure is contained and the next interval can retry',()=>{
  const f=fixture(),request=f.retry.request;f.retry.request=()=>{throw new Error('No network service');};f.retry.start();f.tick();assert.equal(f.timeouts.size,0);assert.equal(f.retry.pending,null);
  f.retry.request=request;f.tick();f.reply(0);assert.equal(f.recovered,1);
});
