import { LocalPeerSignals } from './local-peer-signals.mjs';

export function isPeerPage(value) {
  try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&['caisse.bzh','www.caisse.bzh'].includes(url.hostname)&&['/app/pos','/app/pos/','/app/pos/kitchen','/app/pos/kitchen/'].includes(url.pathname); } catch { return false; }
}
const fail=code=>{throw new Error(code);};
// Document ownership is checked before and after asynchronous native work.
// Starting with no tags prevents a canceled startup from advertising an old
// document's pairings. Only the web layer ever knows keys or plaintext SDP.
export class PeerSignalBridge {
  constructor({authorize,create=()=>new LocalPeerSignals()}){this.authorize=authorize;this.create=create;this.current=null;this.epoch=0;this.starting=false;this.pending=0;}
  invalidate(){this.epoch++;const old=this.current;this.current=null;return old?old.carrier.close():Promise.resolve();}
  async start(event,input){
    const owner=this.authorize(event);if(this.starting)fail('peer_signal_busy');
    if(!Array.isArray(input?.tags)||input.tags.length>64||input.tags.some(tag=>typeof tag!=='string'||!/^[a-f0-9]{32}$/.test(tag)))fail('peer_signal_tags');
    const tags=[...input.tags];this.starting=true;
    try{
      const closing=this.invalidate(),epoch=this.epoch;await closing;
      if(this.epoch!==epoch||this.authorize(event)!==owner)fail('peer_signal_session_changed');
      const carrier=this.create(),session={owner,epoch,carrier,handle:null};this.current=session;
      try{
        const result=await carrier.start([]);
        if(this.current!==session||this.epoch!==epoch||this.authorize(event)!==owner)fail('peer_signal_session_changed');
        session.handle=result.handle;carrier.configure(result.handle,tags);return result;
      }catch(error){if(this.current===session)this.current=null;await carrier.close();throw error;}
    }finally{this.starting=false;}
  }
  async call(event,method,input){
    const owner=this.authorize(event),session=this.current;
    if(method==='stop'&&(!session||session.owner!==owner||session.handle!==input?.handle))return {ok:true,stale:true};
    if(!session||session.owner!==owner||session.handle!==input?.handle)fail('peer_signal_session_changed');
    if(method==='stop'){await this.invalidate();return {ok:true};}
    if(!['configure','poll','send'].includes(method))fail('peer_signal_operation');
    if(this.pending>=8)fail('peer_signal_busy');this.pending++;
    try{
      const result=await(method==='configure'?session.carrier.configure(session.handle,input.tags):method==='poll'?session.carrier.poll(session.handle):session.carrier.send(session.handle,{instance:input.instance,tag:input.tag,nonce:input.nonce,ciphertext:input.ciphertext}));
      if(this.current!==session||this.epoch!==session.epoch||this.authorize(event)!==owner)fail('peer_signal_session_changed');
      return result;
    }finally{this.pending--;}
  }
}
