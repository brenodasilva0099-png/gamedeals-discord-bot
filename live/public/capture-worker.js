'use strict';
// Consome frames da captura sem depender de requestVideoFrameCallback ou pintura da guia.
// Se o navegador nao aceitar MediaStreamTrackProcessor no worker, o transmissor volta ao modo classico.
let active=false,reader=null,track=null,releaseAck=null;
function release(){const fn=releaseAck;releaseAck=null;fn?.();}
function stop(){
  active=false;
  release();
  reader?.cancel().catch(()=>{});
  track?.stop();
}
async function processCapture(source,fps){
  try{
    if(typeof MediaStreamTrackProcessor!=='function')throw Error('MediaStreamTrackProcessor indisponível no worker');
    track=source;
    const processor=new MediaStreamTrackProcessor({track:source});
    reader=processor.readable.getReader();
    let lastFrameAt=0;
    self.postMessage({type:'ready'});
    while(active){
      const {value,done}=await reader.read();
      if(done||!active){value?.close();break;}
      if(!value)continue;
      const now=performance.now();
      if(now-lastFrameAt<1000/fps-1){value.close();continue;}
      lastFrameAt=now;
      // Backpressure: nao enviar proximo VideoFrame ate a pagina liberar este.
      await new Promise(resolve=>{
        releaseAck=resolve;
        try{self.postMessage({type:'frame',frame:value},[value]);}
        catch(error){
          value.close();
          release();
          active=false;
          self.postMessage({type:'error',message:error?.message||'Falha ao transferir quadro'});
        }
      });
    }
  }catch(error){
    if(active)self.postMessage({type:'error',message:error?.message||'Captura por worker indisponível'});
  }finally{stop();}
}
self.onmessage=({data})=>{
  if(data?.type==='start'&&!active){
    active=true;
    processCapture(data.track,Math.max(1,Math.min(60,Number(data.fps)||30)));
  }
  if(data?.type==='ack')release();
  if(data?.type==='stop')stop();
};
