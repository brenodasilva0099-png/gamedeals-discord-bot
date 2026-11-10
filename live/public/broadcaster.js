'use strict';
const $=id=>document.getElementById(id);
const feedback=msg=>{$('feedback').textContent=msg;};
const hash=new URLSearchParams(location.hash.slice(1));
const roomId=hash.get('room'),token=hash.get('key');
history.replaceState(null,'',location.pathname);
if(!roomId||!token){$('start').disabled=true;feedback('Link de transmissão inválido. Copie um link novo dentro da GameDeals Activity.');}
let stream=null,ws=null,encoder=null,frameTimer=null,statsTimer=null,frameNo=0,enabled=false,video=$('preview');
const wsUrl=()=>`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/live/ws`;
async function encoderConfig(width,height,fps){
  for(const codec of ['vp8','avc1.42E01E']){
    const opts={codec,width,height,bitrate:height===720?1_800_000:850_000,framerate:fps,latencyMode:'realtime'};
    if(codec.startsWith('avc1'))opts.avc={format:'annexb'};
    try{const support=await VideoEncoder.isConfigSupported(opts);if(support.supported)return opts;}catch{}
  }
  throw Error('Este navegador não suporta codificação WebCodecs compatível. Tente Chrome ou Edge atualizado.');
}
function disconnect(){if(frameTimer){clearInterval(frameTimer);frameTimer=null;}if(statsTimer){clearInterval(statsTimer);statsTimer=null;}try{encoder?.close();}catch{}encoder=null;
  if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'stop'}));ws.close();}ws=null;
  for(const t of stream?.getTracks()||[])t.stop();stream=null;video.srcObject=null;enabled=false;
  $('stop').disabled=true;$('start').disabled=!roomId||!token;$('empty').style.display='flex';$('network').textContent='Desconectado';$('stats').textContent='Compartilhamento encerrado';}
async function begin(){if(enabled||!roomId||!token)return;
  $('start').disabled=true;feedback('Selecione uma tela ou janela para transmitir.');
  try{
    if(!window.VideoEncoder || !window.VideoFrame)throw Error('WebCodecs indisponível neste navegador');
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:Number($('framerate').value),max:30}},audio:false});
    stream.getVideoTracks()[0].addEventListener('ended',disconnect,{once:true});
    video.srcObject=stream;await video.play();
    const maxH=Number($('resolution').value),fps=Number($('framerate').value);
    const sourceW=video.videoWidth||1280,sourceH=video.videoHeight||720;
    const height=Math.min(maxH,sourceH),width=Math.min(1600,Math.round((sourceW/sourceH)*height/2)*2);
    const config=await encoderConfig(width,height,fps);
    ws=new WebSocket(wsUrl());
    ws.binaryType='arraybuffer';
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Conexão expirou')),8000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('WebSocket indisponível'));};});
    ws.send(JSON.stringify({role:'host',roomId,token}));
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Sala não autorizada')),5000);ws.onmessage=({data})=>{if(typeof data==='string'){const m=JSON.parse(data);if(m.type==='connected'){clearTimeout(timer);resolve();}}};ws.onclose=()=>{clearTimeout(timer);reject(Error('Conexão recusada pela sala'));};});
    ws.send(JSON.stringify({type:'config',codec:config.codec,width,height,fps}));
    const captureCanvas=document.createElement('canvas');captureCanvas.width=width;captureCanvas.height=height;
    const ctx=captureCanvas.getContext('2d',{alpha:false,desynchronized:true});
    encoder=new VideoEncoder({output(chunk){
      if(!ws || ws.readyState!==WebSocket.OPEN || ws.bufferedAmount>1024*1024 ||chunk.byteLength>256*1024)return;
      const arr=new Uint8Array(9+chunk.byteLength),header=new DataView(arr.buffer);
      header.setUint8(0,chunk.type==='key'?1:0);header.setBigUint64(1,BigInt(chunk.timestamp));chunk.copyTo(arr.subarray(9));ws.send(arr);
    },error(e){feedback('Erro na codificação: '+e.message);disconnect();}});
    encoder.configure(config);frameNo=0;enabled=true;
    frameTimer=setInterval(()=>{
      if(!encoder||encoder.state!=='configured'||ws?.readyState!==WebSocket.OPEN||ws.bufferedAmount>1_000_000||encoder.encodeQueueSize>2)return;
      try{ctx.drawImage(video,0,0,width,height);const frame=new VideoFrame(captureCanvas,{timestamp:Math.round(performance.now()*1000)});
        encoder.encode(frame,{keyFrame:frameNo++ % fps===0});frame.close();}catch(e){feedback('Captura indisponível: '+e.message);}
    },1000/fps);
    statsTimer=setInterval(()=>{$('stats').textContent=`${height}p • ${fps} FPS máx. • Fila ${Math.round((ws?.bufferedAmount||0)/1024)} KB`;},1200);
    $('stop').disabled=false;$('empty').style.display='none';$('network').textContent='● Ao vivo';feedback('Transmitindo. Para encerrar, clique em Parar ou feche esta página.');
    ws.onmessage=({data})=>{if(typeof data!=='string')return;try{const msg=JSON.parse(data);if(msg.type==='keyframe')frameNo=0;if(msg.type==='viewers')$('stats').textContent=`${height}p • ${msg.count} espectadores`; }catch{}};
    ws.onclose=()=>{feedback('Conexão perdida. A transmissão foi interrompida para proteger sua privacidade.');disconnect();};
  }catch(e){feedback(e.message||'Erro ao iniciar captura');disconnect();}
}
$('start').onclick=begin;$('stop').onclick=disconnect;window.addEventListener('beforeunload',disconnect);
