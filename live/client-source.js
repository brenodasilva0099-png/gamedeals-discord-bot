import {DiscordSDK} from '@discord/embedded-app-sdk';

const $=id=>document.getElementById(id);
const feedback=msg=>{$('feedback').textContent=msg;};
const canvas=$('video'),ctx=canvas.getContext('2d',{alpha:false});
let ws=null,decoder=null,room=null,online=false,retries=0,closed=false;
let frames=0,lastUpdate=performance.now(),streamConfig=null,audioContext=null,nextAudioAt=0;
const sdk=new DiscordSDK('1569671744803967127');
const wsUrl=()=> (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/live/ws';
const active=value=>{
  online=value;
  $('liveBadge').classList.toggle('active',value);
  $('liveBadge').textContent=value?'● AO VIVO':'● AGUARDANDO';
  canvas.parentNode.classList.toggle('streaming',value);
  if(!value){
    $('quality').textContent='Sem vídeo';
    canvas.width=1;canvas.height=1;
    closeAudio();streamConfig=null;
  }
};
function closeAudio(){
  const a=audioContext;audioContext=null;nextAudioAt=0;
  a?.close().catch(()=>{});
  $('enableAudio').textContent='🔊 Ativar áudio da transmissão';
}
async function enableAudio(){
  if(!streamConfig?.audio)return;
  try{
    if(!audioContext){
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context)throw Error('Áudio indisponível neste navegador.');
      audioContext=new Context({sampleRate:streamConfig.audioSampleRate,latencyHint:'interactive'});
    }
    await audioContext.resume();
    nextAudioAt=audioContext.currentTime+0.1;
    $('enableAudio').textContent='🔊 Áudio ativado';
    feedback('Recebendo áudio da origem compartilhada.');
  }catch(e){feedback('Não foi possível ativar o áudio: '+e.message);}
}
$('enableAudio').onclick=enableAudio;
function playAudio(data){
  if(!audioContext||audioContext.state!=='running'||!streamConfig?.audio)return;
  if(data.byteLength<11||(data.byteLength-9)%2!==0)return;
  const sampleCount=(data.byteLength-9)/2;
  if(sampleCount>65536)return;
  try{
    const samples=new DataView(data);
    const buffer=audioContext.createBuffer(1,sampleCount,streamConfig.audioSampleRate);
    const output=buffer.getChannelData(0);
    for(let i=0;i<sampleCount;i++)output[i]=samples.getInt16(9+i*2,true)/32768;
    const node=audioContext.createBufferSource();
    node.buffer=buffer;node.connect(audioContext.destination);
    // Uma fila muito longa geraria grande latência de áudio; descartar atrasos.
    const now=audioContext.currentTime;
    if(nextAudioAt<now+0.06||nextAudioAt>now+0.45)nextAudioAt=now+0.08;
    node.start(nextAudioAt);
    nextAudioAt+=buffer.duration;
    node.onended=()=>node.disconnect();
  }catch(e){feedback('Problema ao reproduzir o áudio: '+e.message);}
}
async function setup(){
  if(!window.VideoDecoder){feedback('Este navegador não suporta WebCodecs. Atualize o Discord desktop.');return;}
  try{
    await Promise.race([sdk.ready(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Activity não iniciada no Discord')),10000))]);
    const instanceId=sdk.instanceId;
    if(!instanceId)throw Error('ID de sessão não disponível');
    const response=await fetch('/api/live/room',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instanceId})});
    const info=await response.json();
    if(!response.ok)throw Error(info.error||'Falha na sala');
    room=info;
    for(const key of ['copyLink','openBrowser','streamHere'])$(key).disabled=false;
    const revealManualLink=()=>{
      $('manualUrl').hidden=false;
      $('broadcastUrl').value=room.broadcastUrl;
      $('broadcastUrl').focus();$('broadcastUrl').select();
      feedback('O Discord bloqueou a cópia automática. Copie o endereço selecionado com Ctrl+C e abra em uma guia normal do navegador.');
    };
    $('copyLink').onclick=async()=>{
      try{
        if(!navigator.clipboard?.writeText)throw Error('Clipboard indisponível');
        await navigator.clipboard.writeText(room.broadcastUrl);
        feedback('Link copiado! Abra no navegador para transmitir.');
      }catch{revealManualLink();}
    };
    $('openBrowser').onclick=async()=>{
      try{
        const result=await sdk.commands.openExternalLink({url:room.broadcastUrl});
        if(result?.opened===false)feedback('A abertura foi cancelada. Tente novamente ou use Copiar link.');
        else feedback('Confirme no Discord a abertura do navegador. Escolha a tela, confira a prévia e clique em Iniciar transmissão.');
      }catch{revealManualLink();feedback('Não foi possível abrir automaticamente. Use o link selecionado e copie com Ctrl+C.');}
    };
    $('streamHere').onclick=()=>{
      const target=new URL('/live/broadcast',location.origin);
      target.searchParams.set('from','activity');
      target.hash=new URL(room.broadcastUrl).hash;
      location.assign(target.toString());
    };
    connect();
  }catch(err){
    $('network').textContent='Indisponível';
    feedback(err.message+'. Verifique o mapeamento HTTPS da Activity no Developer Portal.');
  }
}
function configure({codec,width,height,fps,audio=false,audioSampleRate=0}){
  try{
    if(decoder){decoder.close();decoder=null;}
    closeAudio();
    streamConfig={codec,width,height,fps,audio,audioSampleRate};
    $('enableAudio').hidden=!audio;
    decoder=new VideoDecoder({
      output(frame){
        try{
          if(canvas.width!==frame.displayWidth||canvas.height!==frame.displayHeight){
            canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;
          }
          ctx.drawImage(frame,0,0,canvas.width,canvas.height);
          frames++;
          const now=performance.now(),elapsed=now-lastUpdate;
          if(elapsed>=1300){
            const actualFps=frames*1000/elapsed;
            $('quality').textContent=width+'×'+height+' · '+actualFps.toFixed(1)+' FPS recebidos (meta '+fps+') · '+codec.toUpperCase()+(audio?' · áudio disponível':' · sem áudio');
            frames=0;lastUpdate=now;
          }
        }finally{frame.close();}
      },
      error(error){feedback('Erro no decodificador: '+error.message);}
    });
    decoder.configure({codec,codedWidth:width,codedHeight:height,optimizeForLatency:true});
    frames=0;lastUpdate=performance.now();
    $('quality').textContent=width+'×'+height+' · aguardando quadros (meta '+fps+' FPS)'+(audio?' · áudio disponível':' · sem áudio');
    active(true);
  }catch(e){feedback('Codec de vídeo incompatível: '+e.message);}
}
function connect(){
  if(!room||closed)return;
  ws=new WebSocket(wsUrl());ws.binaryType='arraybuffer';
  ws.onopen=()=>{
    retries=0;$('network').textContent='Conectado';
    ws.send(JSON.stringify({role:'viewer',roomId:room.roomId,token:room.viewerToken}));
  };
  ws.onmessage=event=>{
    if(typeof event.data==='string'){
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='config')configure(m);
      if(m.type==='status')active(Boolean(m.online));
      if(m.type==='viewers')$('audience').textContent=m.count+' / '+room.limit+' espectadores';
      return;
    }
    const bytes=event.data;
    if(bytes.byteLength<10)return;
    const kind=new DataView(bytes).getUint8(0);
    if(kind===2){playAudio(bytes);return;}
    if(kind!==0&&kind!==1)return;
    if(!decoder||decoder.state!=='configured')return;
    const view=new DataView(bytes);
    try{
      decoder.decode(new EncodedVideoChunk({type:kind===1?'key':'delta',timestamp:Number(view.getBigUint64(1)),data:bytes.slice(9)}));
    }catch(err){
      if(!String(err.message).includes('key frame'))feedback('Reiniciando sincronização de vídeo…');
    }
  };
  ws.onclose=()=>{
    active(false);$('network').textContent='Reconectando…';
    if(decoder){decoder.close();decoder=null;}
    if(!closed)setTimeout(connect,Math.min(8000,800*2**Math.min(retries++,4)));
  };
  ws.onerror=()=>{};
}
$('fullscreen').onclick=()=>{
  if(!document.fullscreenElement){
    canvas.parentNode.requestFullscreen?.().catch(()=>feedback('Tela cheia indisponível neste dispositivo.'));
  }else document.exitFullscreen?.();
};
window.addEventListener('beforeunload',()=>{closed=true;ws?.close();decoder?.close();closeAudio();});
setup();
