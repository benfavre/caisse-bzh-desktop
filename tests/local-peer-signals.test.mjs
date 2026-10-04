import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { createConnection, createServer } from 'node:net';
import { LocalPeerSignals } from '../electron/local-peer-signals.mjs';
const tag='a'.repeat(32),message={tag,nonce:'b'.repeat(24),ciphertext:Buffer.from('opaque authenticated ciphertext placeholder').toString('base64')};
const create=options=>new LocalPeerSignals({bind:'127.0.0.1',multicast:false,...options});
async function advertise(from,to){const socket=createSocket('udp4');try{for(const packet of from.advertisements())await new Promise((resolve,reject)=>socket.send(packet,to.boundDiscoveryPort,'127.0.0.1',error=>error?reject(error):resolve()));}finally{socket.close();}}
async function until(check){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw new Error('condition timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
test('real local UDP discovery and TCP exchange move only opaque boxes and preserve sender identity',async()=>{
 const a=create(),b=create();try{const x=await a.start([tag]),y=await b.start([tag]);await advertise(a,b);await advertise(b,a);await until(()=>a.poll(x.handle).peers.length===1&&b.poll(y.handle).peers.length===1);
  assert.deepEqual(await a.send(x.handle,{...message,instance:y.instance}),{ok:true,queued:true});const received=b.poll(y.handle);assert.deepEqual(received.messages,[{...message,fromInstance:x.instance}]);assert.equal(b.poll(y.handle).messages.length,0);
  assert.ok(!JSON.stringify(received).includes('127.0.0.1'));assert.equal(received.peers[0].tag,tag);
 }finally{await a.close();await b.close();}
});
test('unknown tags, public addresses, oversize adverts and arbitrary destinations cannot authorize sending',async()=>{
 const a=create(),b=create();try{const x=await a.start([tag]),y=await b.start(['c'.repeat(32)]);await advertise(b,a);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(a.poll(x.handle).peers.length,0);
  b.configure(y.handle,[tag]);a.discover(Buffer.from(b.advertisements()[0]),'8.8.8.8');a.discover(Buffer.alloc(1401),'127.0.0.1');assert.equal(a.poll(x.handle).peers.length,0);
  await assert.rejects(a.send(x.handle,{...message,instance:y.instance}),/peer_signal_target/);assert.throws(()=>a.configure(x.handle,['invalid']),/peer_signal_tags/);
 }finally{await a.close();await b.close();}
});
test('old session handles cannot stop a replacement and network traffic does not renew its local lease',async()=>{
 const a=create({leaseMs:100});try{const first=await a.start([tag]),second=await a.start([tag]);assert.notEqual(first.instance,second.instance);assert.deepEqual(await a.stop(first.handle),{ok:true,stale:true});assert.throws(()=>a.poll(first.handle),/peer_signal_session_changed/);
  await new Promise(resolve=>setTimeout(resolve,250));assert.throws(()=>a.poll(second.handle),/peer_signal_session_changed/);
 }finally{await a.close();}
});
test('bounded receive queue rejects overflow and disabling a tag discards its pending signaling',async()=>{
 const a=create(),b=create();try{const x=await a.start([tag]),y=await b.start([tag]);await advertise(b,a);await until(()=>a.poll(x.handle).peers.length===1);
  for(let i=0;i<32;i++)await a.send(x.handle,{...message,instance:y.instance});await assert.rejects(a.send(x.handle,{...message,instance:y.instance}),/peer_signal_not_queued/);
  b.configure(y.handle,[]);assert.equal(b.poll(y.handle).messages.length,0);await assert.rejects(a.send(x.handle,{...message,instance:y.instance}),/peer_signal_not_queued/);
 }finally{await a.close();await b.close();}
});
test('TCP framing rejects wrong process identity and closes idle sockets',async()=>{
 const a=create();let socket;try{await a.start([tag]);socket=createConnection({host:'127.0.0.1',port:a.port});await new Promise(resolve=>socket.once('connect',resolve));socket.write(JSON.stringify({v:1,hello:'f'.repeat(32),fromInstance:'e'.repeat(32)})+'\n');await new Promise(resolve=>socket.once('close',resolve));assert.equal(a.messages.length,0);
  socket=createConnection({host:'127.0.0.1',port:a.port});socket.resume();socket.write(JSON.stringify({padding:'A'.repeat(1500)})+'\n');await new Promise(resolve=>socket.once('close',resolve));assert.equal(a.messages.length,0);
  socket=createConnection({host:'127.0.0.1',port:a.port});socket.resume();await new Promise(resolve=>socket.once('close',resolve));assert.equal(a.messages.length,0);
 }finally{socket?.destroy();await a.close();}
});

test('receive byte budget rejects oversized queues and invalid boxes',async()=>{
 const a=create(),b=create();try{const x=await a.start([tag]),y=await b.start([tag]);await advertise(b,a);await until(()=>a.poll(x.handle).peers.length===1);
  const large={...message,instance:y.instance,ciphertext:'A'.repeat(90000)};
  for(let i=0;i<11;i++)await a.send(x.handle,large);
  await assert.rejects(a.send(x.handle,large),/peer_signal_not_queued/);
  await assert.rejects(a.send(x.handle,{...large,ciphertext:'A'.repeat(90004)}),/peer_signal_box/);
  assert.equal(b.poll(y.handle).messages.length,11);
  assert.equal((await a.send(x.handle,large)).queued,true);
 }finally{await a.close();await b.close();}
});
test('removing a pairing while awaiting hello prevents ciphertext transmission',async()=>{
 const a=create();let socket,extra='';const server=createServer(client=>{socket=client;client.setEncoding('utf8');let buffer='';client.on('data',data=>{buffer+=data;if(buffer.includes('\n')){client.removeAllListeners('data');client.on('data',data=>{extra+=data;});a.configure(session.handle,[]);client.write(JSON.stringify({v:1,instance:remote})+'\n');}});});
 const remote='c'.repeat(32);let session;
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));session=await a.start([tag]);a.discover(Buffer.from(JSON.stringify({v:1,type:'caisse-peer-signal',instance:remote,port:server.address().port,tags:[tag]})),'127.0.0.1');
  await assert.rejects(a.send(session.handle,{...message,instance:remote}),/peer_signal_session_changed/);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(extra,'');
 }finally{socket?.destroy();await a.close();await new Promise(resolve=>server.close(resolve));}
});
test('a trickling client cannot keep a socket past its absolute deadline',async()=>{
 const a=create();let socket,timer;try{await a.start([tag]);socket=createConnection({host:'127.0.0.1',port:a.port});socket.on('error',()=>{});socket.resume();const started=performance.now();timer=setInterval(()=>socket.write(' '),100);await new Promise(resolve=>socket.once('close',resolve));const elapsed=performance.now()-started;assert.ok(elapsed>=9000&&elapsed<13000,`deadline elapsed ${elapsed}`);assert.equal(a.messages.length,0);
 }finally{clearInterval(timer);socket?.destroy();await a.close();}
});
test('retired listener callbacks cannot discover peers or close a replacement session',async()=>{
 const a=create(),b=create();try{await a.start([tag]);const oldServer=a.server,oldUdp=a.udp;const current=await a.start([tag]);await b.start([tag]);
  oldUdp.emit('message',Buffer.from(b.advertisements()[0]),{address:'127.0.0.1'});oldUdp.emit('error',new Error('retired discovery'));oldServer.emit('error',new Error('retired listener'));
  await new Promise(resolve=>setTimeout(resolve,10));const status=a.poll(current.handle);assert.deepEqual(status.peers,[]);assert.equal(status.error,null);
 }finally{await a.close();await b.close();}
});
