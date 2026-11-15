'use strict';
const $=id=>document.getElementById(id);
const feedback=msg=>{$('feedback').textContent=msg;};
const hash=new URLSearchParams(location.hash.slice(1));
const roomId=hash.get('room'),token=hash.get('key');
const fromActivity=new URL(location.href).searchParams.get('from')==='activity'||location.hostname.endsWith('.discordsays.com');
history.replaceState(null,'',location.pathname);
if(fromActivity){
  $('activityNotice').hidden=false;
  $('backToActivity').hidden=false;
  $('backToActivity').onclick=()=>location.assign('/live/');
}
const video=$('preview');
let stream=null,ws=null,encoder=null,audioContext=null,audioProcessor=null,audioSource=null,silentNode=null;
let captureHandle=0,statsTimer=null,transmitting=false,prepared=false,stopping=false;
let selected=null,output=null,sourceFps=0,requestedFps=30,lastEncodeAt=0,frameNo=0,framesSent=0,bytesSent=0,dropped=0,statsAt=0;
const wsUrl=()=> (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/live/ws';
const RATE_LIMIT=3*1024*1024;
const permitted=!!roomId&&!!token;
function setActions(){
  $('selectSource').disabled=transmitting||!permitted;
  $('start').disabled=!prepared||transmitting||!permitted;
  $('stop').disabled=!prepared&&!transmitting;
  for(const key of ['resolution','framerate','audioMode'])$(key).disabled=prepared||transmitting;
}
if(!permitted)feedback('Link inválido ou expirado. Abra a Activity do GameDeals e gere outro endereço.');
setActions();
function terminateAudio(){
  try{audioProcessor?.disconnect();}catch{}
  try{audioSource?.disconnect();}catch{}
  try{silentNode?.disconnect();}catch{}
  audioProcessor=null;audioSource=null;silentNode=null;
  const a=audioContext;audioContext=null;
  a?.close().catch(()=>{});
}
function disconnect(reason='Compartilhamento encerrado'){
  if(stopping)return;
  stopping=true;transmitting=false;
  if(captureHandle&&video.cancelVideoFrameCallback){try{video.cancelVideoFrameCallback(captureHandle);}catch{}}
  captureHandle=0;
  if(statsTimer)clearInterval(statsTimer);
  statsTimer=null;
  try{encoder?.close();}catch{}encoder=null;
  try{if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'stop'}));ws.close();}else ws?.close();}catch{}
  ws=null;terminateAudio();
  for(const t of stream?.getTracks()||[])t.stop();
  stream=null;video.pause();video.srcObject=null;
  prepared=false;selected=null;output=null;
  $('empty').style.display='flex';
  $('network').textContent='Desconectado';
  $('stats').textContent=reason;
  $('sourceInfo').textContent='Escolha uma tela ou janela para preparar outra transmissão.';
  setActions();stopping=false;
}
function captureError(error){
  const denied=['NotAllowedError','SecurityError','InvalidStateError'].includes(error?.name);
  if(fromActivity&&denied)return 'O Discord bloqueou a captura antes de mostrar as janelas. Volte à Activity e use Abrir no navegador. Esta restrição não pode ser contornada pelo site.';
  if(denied)return 'Captura não autorizada. Clique em Escolher tela ou janela e permita a seleção no navegador.';
  return error?.message||'Não foi possível escolher a tela.';
}
async function selectSource(){
  if(transmitting||!permitted)return;
  if(stream)disconnect('Selecionando outra tela…');
  $('selectSource').disabled=true;
  feedback('Aguardando o seletor de telas/janelas do navegador…');
  try{
    if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Captura indisponível. Abra em Chrome, Edge ou Opera atualizado.');
    const policy=document.permissionsPolicy||document.featurePolicy;
    if(fromActivity&&policy?.allowsFeature&&!policy.allowsFeature('display-capture')){
      const e=new Error('Permissão de captura bloqueada pelo Discord.');e.name='SecurityError';throw e;
    }
    const wantsAudio=$('audioMode').value==='system';
    requestedFps=Number($('framerate').value);
    stream=await navigator.mediaDevices.getDisplayMedia({
      video:{frameRate:{ideal:requestedFps}},audio:wantsAudio,
      systemAudio:wantsAudio?'include':'exclude',
      surfaceSwitching:'include',selfBrowserSurface:'exclude'
    });
    const track=stream.getVideoTracks()[0];
    if(!track)throw Error('Nenhum vídeo retornado pelo navegador.');
    track.addEventListener('ended',()=>disconnect('Captura encerrada no navegador.'),{once:true});
    video.srcObject=stream;await video.play();
    if(!video.videoWidth||!video.videoHeight)await new Promise(resolve=>{
      video.addEventListener('loadedmetadata',resolve,{once:true});setTimeout(resolve,2500);
    });
    const settings=track.getSettings();
    const sourceWidth=video.videoWidth||settings.width,sourceHeight=video.videoHeight||settings.height;
    selected=GDQuality.dimensions(sourceWidth,sourceHeight,Number($('resolution').value));
    sourceFps=Number(settings.frameRate)||0;
    const audioTrack=wantsAudio?stream.getAudioTracks()[0]:null;
    output={width:selected.width,height:selected.height,audioRequested:wantsAudio,audioAvailable:!!audioTrack,sourceWidth,sourceHeight};
    prepared=true;
    $('empty').style.display='none';$('network').textContent='Prévia preparada';
    const src=sourceWidth+'×'+sourceHeight+(sourceFps?' · fonte informa '+Math.round(sourceFps)+' FPS':'');
    const actual=selected.width+'×'+selected.height;
    $('sourceInfo').textContent='Fonte: '+src+'. Saída planejada: '+actual+', até '+requestedFps+' FPS (medidos ao vivo). '+(wantsAudio?(audioTrack?'Faixa de áudio disponível.':'Esta origem não forneceu áudio: a transmissão será silenciosa.'):'Áudio desligado.');
    feedback(selected.native?'Prévia pronta, sem aumento artificial de resolução. Clique em Iniciar transmissão.':'Prévia pronta. Resolução ajustada sem ampliar artificialmente a origem.');
  }catch(error){
    if(stream)for(const t of stream.getTracks())t.stop();
    stream=null;video.srcObject=null;prepared=false;feedback(captureError(error));
  }finally{setActions();}
}
async function encoderConfig(width,height,fps){
  const bitrate=GDQuality.bitrate(width,height,fps);
  for(const codec of ['avc1.640033','vp8','avc1.42E01E']){
    const opts={codec,width,height,bitrate,framerate:fps,latencyMode:'realtime',hardwareAcceleration:'prefer-hardware'};
    if(codec.startsWith('avc1'))opts.avc={format:'annexb'};
    try{if((await VideoEncoder.isConfigSupported(opts)).supported)return opts;}catch{}
  }
  throw Error('O navegador não suporta codificar essa resolução/FPS. Reduza a qualidade ou use outro navegador.');
}
async function setupAudio(){
  if(!output.audioAvailable||!stream?.getAudioTracks().length)return false;
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw Error('Web Audio indisponível');
    audioContext=new Context({sampleRate:48000,latencyHint:'interactive'});
    if(![44100,48000].includes(audioContext.sampleRate))throw Error('Taxa de amostragem não suportada');
    if(!audioContext.createScriptProcessor)throw Error('Processamento PCM indisponível');
    await audioContext.resume();
    audioSource=audioContext.createMediaStreamSource(new MediaStream([stream.getAudioTracks()[0]]));
    audioProcessor=audioContext.createScriptProcessor(2048,1,1);
    silentNode=audioContext.createGain();silentNode.gain.value=0;
    audioProcessor.onaudioprocess=event=>{
      if(!transmitting||!ws||ws.readyState!==WebSocket.OPEN||ws.bufferedAmount>RATE_LIMIT)return;
      const samples=event.inputBuffer.getChannelData(0);
      const packet=new Uint8Array(9+samples.length*2);
      const view=new DataView(packet.buffer);view.setUint8(0,2);
      view.setBigUint64(1,BigInt(Math.round(performance.now()*1000)));
      for(let i=0;i<samples.length;i++)view.setInt16(9+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
      ws.send(packet);
    };
    audioSource.connect(audioProcessor);audioProcessor.connect(silentNode);silentNode.connect(audioContext.destination);
    return true;
  }catch(error){
    terminateAudio();feedback('Não foi possível ligar o áudio: '+(error.message||error));return false;
  }
}
function videoFrame(now,metadata){
  if(!transmitting||!encoder)return;
  captureHandle=video.requestVideoFrameCallback(videoFrame);
  if(now-lastEncodeAt<1000/requestedFps-2)return;
  if(encoder.state!=='configured'||encoder.encodeQueueSize>2||ws?.readyState!==WebSocket.OPEN||ws.bufferedAmount>RATE_LIMIT){dropped++;return;}
  try{
    lastEncodeAt=now;
    output.context.drawImage(video,0,0,output.width,output.height);
    const frame=new VideoFrame(output.canvas,{timestamp:Math.round(now*1000)});
    encoder.encode(frame,{keyFrame:frameNo++ % (requestedFps*2)===0});frame.close();
  }catch(error){feedback('Falha de captura: '+(error.message||error));}
}
function monitor(){
  const now=performance.now(),delta=Math.max(0.1,(now-statsAt)/1000);
  const fps=framesSent/delta,mbps=bytesSent*8/delta/1000000;
  framesSent=0;bytesSent=0;statsAt=now;
  $('stats').textContent=output.width+'×'+output.height+' · '+fps.toFixed(1)+' FPS efetivamente enviados (meta '+requestedFps+') · '+mbps.toFixed(1)+' Mb/s · '+dropped+' quadros ignorados';
  dropped=0;
}
async function begin(){
  if(!prepared||transmitting||!permitted)return;
  $('start').disabled=true;feedback('Verificando codificador e preparando a transmissão…');
  try{
    if(!window.VideoEncoder||!window.VideoFrame||!video.requestVideoFrameCallback)throw Error('Este navegador não oferece as APIs necessárias para capturar quadros únicos. Tente Chrome, Edge ou Opera atualizado.');
    // Começar o contexto de áudio imediatamente sob o clique do usuário evita bloqueio de autoplay.
    const hasAudio=await setupAudio();
    const config=await encoderConfig(output.width,output.height,requestedFps);
    ws=new WebSocket(wsUrl());ws.binaryType='arraybuffer';
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Conexão WebSocket expirou')),8000);
      ws.onopen=()=>{clearTimeout(timer);resolve();};
      ws.onerror=()=>{clearTimeout(timer);reject(Error('WebSocket indisponível'));};
    });
    ws.send(JSON.stringify({role:'host',roomId,token}));
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Sessão não autorizada')),5000);
      ws.onmessage=({data})=>{
        try{if(typeof data==='string'&&JSON.parse(data).type==='connected'){clearTimeout(timer);resolve();}}catch{}
      };
      ws.onclose=()=>{clearTimeout(timer);reject(Error('Sala encerrada ou inválida'));};
    });
    ws.send(JSON.stringify({type:'config',codec:config.codec,width:output.width,height:output.height,fps:requestedFps,
      audio:hasAudio,audioSampleRate:hasAudio?audioContext.sampleRate:0}));
    const canvas=document.createElement('canvas');canvas.width=output.width;canvas.height=output.height;
    output.canvas=canvas;output.context=canvas.getContext('2d',{alpha:false,desynchronized:true});
    encoder=new VideoEncoder({
      output(chunk){
        if(!transmitting||!ws||ws.readyState!==WebSocket.OPEN||ws.bufferedAmount>RATE_LIMIT||chunk.byteLength>1024*1024){dropped++;return;}
        const packet=new Uint8Array(9+chunk.byteLength);
        const header=new DataView(packet.buffer);header.setUint8(0,chunk.type==='key'?1:0);
        header.setBigUint64(1,BigInt(chunk.timestamp));chunk.copyTo(packet.subarray(9));
        ws.send(packet);framesSent++;bytesSent+=packet.byteLength;
      },
      error(error){feedback('Falha no codificador: '+error.message);disconnect('Codificador interrompido');}
    });
    encoder.configure(config);
    transmitting=true;framesSent=0;bytesSent=0;dropped=0;frameNo=0;lastEncodeAt=0;statsAt=performance.now();
    captureHandle=video.requestVideoFrameCallback(videoFrame);
    statsTimer=setInterval(monitor,1500);
    $('network').textContent='● AO VIVO';setActions();
    feedback('Transmitindo '+output.width+'×'+output.height+'; FPS reais aparecem nas estatísticas. '+(hasAudio?'Áudio real da origem ligado.':output.audioRequested?'Sem som: o navegador não forneceu áudio utilizável.':'Sem áudio, como selecionado.'));
    ws.onmessage=({data})=>{if(typeof data!=='string')return;try{if(JSON.parse(data).type==='keyframe')frameNo=0;}catch{}};
    ws.onclose=()=>{feedback('Conexão encerrada.');disconnect('Conexão perdida');};
  }catch(error){const message=error.message||'Falha ao iniciar transmissão';disconnect('Falha ao iniciar transmissão');feedback(message);}
}
$('selectSource').onclick=selectSource;
$('start').onclick=begin;
$('stop').onclick=()=>disconnect();
window.addEventListener('beforeunload',()=>disconnect());
