import { createServer, createConnection } from 'node:net';
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export const SIGNAL_GROUP = '239.255.67.83', SIGNAL_PORT = 43183;
const MAX_LINE = 100000, MAX_BOX = 90000, QUEUE_BYTES = 1048576;
const hex = (value, size) => typeof value === 'string' && new RegExp('^[a-f0-9]{'+size+'}$').test(value);
const privateAddress = value => /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value || '');
const fail = code => { throw new Error(code); };
function tags(values) {
  if (!Array.isArray(values) || values.length > 64 || values.some(value => !hex(value,32))) fail('peer_signal_tags');
  return [...new Set(values)];
}
function box(value) {
  if (!value || !hex(value.tag,32) || !hex(value.nonce,24) || typeof value.ciphertext !== 'string' || value.ciphertext.length < 24 || value.ciphertext.length > MAX_BOX || value.ciphertext.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)) fail('peer_signal_box');
  return { tag:value.tag, nonce:value.nonce, ciphertext:value.ciphertext };
}
function parseHeader(line){if(Buffer.byteLength(line)>1400)fail('peer_signal_frame');return JSON.parse(line);}
function reader(socket) {
  let buffer='',waiting=null,ended=false; const ready=[];
  function abort(){ended=true;if(waiting){waiting.reject(new Error('peer_signal_network'));waiting=null;}}
  socket.setEncoding('utf8');socket.setTimeout(5000,()=>socket.destroy());
  const deadline=setTimeout(()=>socket.destroy(),10000);deadline.unref?.();socket.once('close',()=>clearTimeout(deadline));
  socket.on('error',abort);socket.on('close',abort);
  socket.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>MAX_LINE){socket.destroy();return;}
    let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(waiting){const w=waiting;waiting=null;w.resolve(line);}else{ready.push(line);if(ready.length>2){socket.destroy();return;}}}
  });
  return ()=>new Promise((resolve,reject)=>{if(ready.length)return resolve(ready.shift());if(ended)return reject(new Error('peer_signal_network'));if(waiting)return reject(new Error('peer_signal_busy'));waiting={resolve,reject};});
}
const write = (socket,value) => socket.write(JSON.stringify(value)+'\n');

// Opaque signaling only. Tags/ciphertexts are supplied by the authenticated web
// resumption layer; receipt means queued locally, never a kitchen/fiscal ACK.
export class LocalPeerSignals {
  constructor({bind='0.0.0.0',multicast=true,discoveryPort=multicast?SIGNAL_PORT:0,leaseMs=15000}={}) {
    this.bind=bind;this.multicast=multicast;this.discoveryPort=discoveryPort;this.leaseMs=leaseMs;this.sockets=new Set();this.peers=new Map();this.messages=[];this.bytes=0;this.timer=null;this.changes=Promise.resolve();
  }
  transition(action){const work=this.changes.catch(()=>{}).then(action);this.changes=work;return work;}
  start(values){const wanted=tags(values);return this.transition(()=>this.open(wanted));}
  async open(wanted) {
    await this.reset();
    this.handle=randomBytes(16).toString('hex');this.instance=randomBytes(16).toString('hex');this.tags=new Set(wanted);this.live=true;this.touched=performance.now();this.lastAdvert=-Infinity;this.error=null;
    const epoch=this.handle;
    try {
      this.server=createServer(socket=>{if(!this.live||epoch!==this.handle||!privateAddress(socket.remoteAddress)||this.sockets.size>=8){socket.destroy();return;}this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));void this.receive(socket).catch(()=>socket.destroy());});
      this.server.on('error',()=>{if(epoch===this.handle){this.error='peer_signal_network';void this.stop(epoch);}});
      await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,this.bind,resolve);});
      this.port=this.server.address().port;
      this.udp=createSocket({type:'udp4',reuseAddr:true});this.udp.on('error',()=>{if(epoch===this.handle)this.error='peer_signal_network';});
      this.udp.on('message',(data,remote)=>{if(epoch===this.handle)this.discover(data,remote.address);});
      await new Promise((resolve,reject)=>{this.udp.once('error',reject);this.udp.bind(this.discoveryPort,this.bind,resolve);});
      this.boundDiscoveryPort=this.udp.address().port;if(this.multicast)this.udp.setMulticastTTL(1);
      this.timer=setInterval(()=>this.tick(),Math.min(1000,this.leaseMs));this.timer.unref?.();this.tick();
      return {ok:true,handle:this.handle,instance:this.instance};
    } catch(error){await this.reset();throw error;}
  }
  check(handle){if(!this.live||handle!==this.handle)fail('peer_signal_session_changed');if(performance.now()-this.touched>this.leaseMs){void this.close();fail('peer_signal_session_changed');}this.touched=performance.now();}
  configure(handle,values){this.check(handle);this.tags=new Set(tags(values));for(const [key,value]of this.peers)if(!this.tags.has(value.tag))this.peers.delete(key);this.messages=this.messages.filter(value=>this.tags.has(value.tag));this.bytes=this.messages.reduce((n,value)=>n+value.ciphertext.length,0);this.lastAdvert=-Infinity;return {ok:true};}
  advertisements(){const values=[...this.tags],packets=[];for(let i=0;i<values.length;i+=8)packets.push(JSON.stringify({v:1,type:'caisse-peer-signal',instance:this.instance,port:this.port,tags:values.slice(i,i+8)}));return packets;}
  discover(data,address){
    if(!this.live||!privateAddress(address)||data.length>1400)return;
    try{const value=JSON.parse(String(data));if(value.v!==1||value.type!=='caisse-peer-signal'||!hex(value.instance,32)||value.instance===this.instance||!Number.isSafeInteger(value.port)||value.port<1||value.port>65535||!Array.isArray(value.tags)||value.tags.length>8)return;
      for(const tag of tags(value.tags)){if(!this.tags.has(tag))continue;const key=value.instance+':'+tag;if(!this.peers.has(key)&&this.peers.size>=128)continue;this.peers.set(key,{instance:value.instance,tag,address,port:value.port,seen:performance.now()});}
    }catch{}
  }
  tick(){
    if(!this.live)return;if(performance.now()-this.touched>this.leaseMs){void this.close();return;}
    for(const [key,peer]of this.peers)if(performance.now()-peer.seen>15000)this.peers.delete(key);
    this.messages=this.messages.filter(value=>performance.now()-value.at<=15000);this.bytes=this.messages.reduce((n,value)=>n+value.ciphertext.length,0);
    if(!this.multicast||performance.now()-this.lastAdvert<5000)return;this.lastAdvert=performance.now();
    for(const entries of Object.values(networkInterfaces()))for(const entry of entries||[]){if(entry.family!=='IPv4'||entry.internal)continue;
      try{this.udp.addMembership(SIGNAL_GROUP,entry.address);}catch{}
      try{this.udp.setMulticastInterface(entry.address);for(const packet of this.advertisements())this.udp.send(packet,SIGNAL_PORT,SIGNAL_GROUP);}catch{this.error='peer_signal_network';}
    }
  }
  async receive(socket){
    const epoch=this.handle,next=reader(socket),hello=parseHeader(await next());
    if(!this.live||epoch!==this.handle||hello.v!==1||hello.hello!==this.instance||!hex(hello.fromInstance,32))return socket.destroy();
    write(socket,{v:1,instance:this.instance});const header=parseHeader(await next()),message=box({...header,ciphertext:await next()});
    if(!this.live||epoch!==this.handle||!this.tags.has(message.tag)||this.messages.length>=32||this.bytes+message.ciphertext.length>QUEUE_BYTES){write(socket,{ok:false});return socket.end();}
    this.messages.push({...message,fromInstance:hello.fromInstance,at:performance.now()});this.bytes+=message.ciphertext.length;write(socket,{ok:true});socket.end();
  }
  poll(handle){this.check(handle);const messages=this.messages.filter(value=>performance.now()-value.at<=15000).map(({at,...value})=>value);this.messages=[];this.bytes=0;return {ok:true,instance:this.instance,peers:[...this.peers.values()].filter(value=>performance.now()-value.seen<=15000).map(({instance,tag})=>({instance,tag})),messages,error:this.error};}
  async send(handle,input){
    this.check(handle);const message=box(input),target=this.peers.get(input.instance+':'+message.tag);if(!target||performance.now()-target.seen>15000||!this.tags.has(message.tag))fail('peer_signal_target');
    if(this.sockets.size>=8)fail('peer_signal_busy');const epoch=this.handle,socket=createConnection({host:target.address,port:target.port});this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));const next=reader(socket);
    try{write(socket,{v:1,hello:target.instance,fromInstance:this.instance});const hello=parseHeader(await next());if(!this.live||epoch!==this.handle||!this.tags.has(message.tag)||hello.v!==1||hello.instance!==target.instance)fail('peer_signal_session_changed');socket.write(JSON.stringify({tag:message.tag,nonce:message.nonce})+'\n'+message.ciphertext+'\n');const receipt=parseHeader(await next());if(!this.live||epoch!==this.handle||!this.tags.has(message.tag)||receipt.ok!==true)fail('peer_signal_not_queued');return {ok:true,queued:true};}finally{socket.destroy();}
  }
  stop(handle){return this.transition(async()=>{if(!this.live||handle!==this.handle)return {ok:true,stale:true};await this.reset();return {ok:true};});}
  close(){return this.transition(()=>this.reset());}
  async reset(){this.live=false;clearInterval(this.timer);this.timer=null;for(const socket of this.sockets)socket.destroy();this.sockets.clear();this.peers.clear();this.messages=[];this.bytes=0;const server=this.server,udp=this.udp;this.server=null;this.udp=null;
    if(server)await new Promise(resolve=>{try{server.close(resolve);}catch{resolve();}});if(udp)await new Promise(resolve=>{try{udp.close(resolve);}catch{resolve();}});
  }
}
