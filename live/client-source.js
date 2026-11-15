import {DiscordSDK} from '@discord/embedded-app-sdk';

const $=id=>document.getElementById(id);
const feedback=msg=>{$('feedback').textContent=msg;};
const canvas=$('video'),ctx=canvas.getContext('2d',{alpha:false});
let ws=null,decoder=null,room=null,online=false,retries=0,closed=false;
let frames=0,lastUpdate=performance.now(),streamConfig=null,audioContext=null,nextAudioAt=0;
let isHostOnline=false,lastDecodedAt=0,lastRelayAt=0,relayFrames=0,diagnosticTimer=null;
let selectedStreamId=null;
const streamPicker=$('streamPicker');
function switchStream(streamId){
  if(selectedStreamId===streamId)return;
  selectedStreamId=streamId;
  if(decoder){try{decoder.close();}catch{}decoder=null;}
  isHostOnline=false;lastDecodedAt=0;lastRelayAt=0;relayFrames=0;
  active(false);
  signal(streamId?'Mudando de transmissão. Aguardando o vídeo selecionado.':'Aguardando alguém iniciar uma transmissão.');
}
function updateStreamList(message){
  const streams=Array.isArray(message.streams)?message.streams:[];
  const choice=message.selectedStreamId||'';
  if(choice&&choice!==selectedStreamId)switchStream(choice);
  streamPicker.replaceChildren();
  if(!streams.length){
    streamPicker.add(new Option('Nenhuma transmissão disponível',''));
  }else{
    for(const stream of streams){
      if(typeof stream.id!=='string')continue;
      const name=typeof stream.label==='string'?stream.label:'Tela';
      streamPicker.add(new Option(name+(stream.online?' · transmitindo':' · preparando'),stream.id));
    }
  }
  const current=selectedStreamId&&streams.some(s=>s.id===selectedStreamId)?selectedStreamId:(streams[0]?.id||'');
  streamPicker.value=current;
  streamPicker.disabled=streams.length<2;
  $('streamCount').textContent=streams.length===0?'Nenhuma tela conectada':streams.length===1?'1 transmissão disponível':streams.length+' transmissões disponíveis';
}
streamPicker.onchange=()=>{
  const streamId=streamPicker.value;
  if(!streamId||ws?.readyState!==WebSocket.OPEN)return;
  ws.send(JSON.stringify({type:'select-stream',streamId}));
  signal('Selecionando outra transmissão…');
};
const signal=message=>{$('streamStatus').textContent=message;};
function updateControls(stage){
  const live=stage==='playing',connecting=stage==='connecting';
  $('controlTitle').textContent=live?'Transmissão em andamento':connecting?'Conectando transmissão…':'Iniciar sua transmissão';
  $('controlDescription').textContent=live
    ?'O vídeo está sendo recebido na Activity. Para encerrar a transmissão, clique em Parar na guia do navegador transmissor.'
    :connecting
      ?'A guia transmissora foi reconhecida, mas o vídeo ainda está sendo sincronizado. Confira o estado da sala abaixo.'
      :'Escolha onde compartilhar a tela. A captura só começa quando você autorizar a janela ou tela.';
}
const sdk=new DiscordSDK('1569671744803967127');
const wsUrl=()=> (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/live/ws';
const active=value=>{
  online=value;
  $('liveBadge').classList.toggle('active',value);
  $('liveBadge').textContent=value?'● AO VIVO':'● AGUARDANDO';
  canvas.parentNode.classList.toggle('streaming',value);
  updateControls(value?'playing':isHostOnline?'connecting':'idle');
  if(!value){
    $('quality').textContent='Sem vídeo';
    canvas.width=1;canvas.height=1;
    closeAudio();streamConfig=null;
    $('enableAudio').hidden=true;
    lastDecodedAt=0;
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
    $('sessionInfo').textContent='Sala '+String(room.roomId).slice(-6)+' · Compare este código com o mostrado no navegador transmissor.';
    signal('Sala criada. Aguardando a conexão do transmissor.');
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
          frames++;lastDecodedAt=Date.now();
          if(!online){active(true);signal('Vídeo recebido e decodificado.');}
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
    // O player só anuncia vídeo ativo depois de decodificar o primeiro quadro.
    canvas.parentNode.classList.remove('streaming');
    $('liveBadge').textContent='● AGUARDANDO QUADROS';
    updateControls('connecting');
    signal('Configuração '+width+'×'+height+' recebida. Aguardando os primeiros quadros de vídeo.');
    ws?.send(JSON.stringify({type:'sync'}));
  }catch(e){
    signal('O servidor enviou configuração, mas o decodificador a rejeitou.');
    feedback('Codec de vídeo incompatível: '+e.message);
  }
}
function connect(){
  if(!room||closed)return;
  ws=new WebSocket(wsUrl());ws.binaryType='arraybuffer';
  ws.onopen=()=>{
    retries=0;$('network').textContent='Conectado';
    signal('WebSocket conectado. Aguardando informações do servidor.');
    ws.send(JSON.stringify({role:'viewer',roomId:room.roomId,token:room.viewerToken}));
  };
  ws.onmessage=event=>{
    if(typeof event.data==='string'){
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='stream-list')updateStreamList(m);
      if(m.type==='stream-selected')switchStream(m.streamId||null);
      if(m.type==='stream-error')feedback(m.error||'Não foi possível selecionar esta transmissão.');
      if(m.type==='config'){
        if(!streamConfig||streamConfig.codec!==m.codec||streamConfig.width!==m.width||streamConfig.height!==m.height||streamConfig.fps!==m.fps)configure(m);
      }
      if(m.type==='connected')signal('Conectado à sala '+String(m.room||room.roomId).slice(-6)+'. Aguardando transmissor.');
      if(m.type==='status'){
        isHostOnline=Boolean(m.online);
        if(!isHostOnline){
          active(false);
          $('liveBadge').textContent='● AGUARDANDO';
          signal('Nenhum transmissor conectado nesta sala. Abra uma nova guia pelo botão Abrir no navegador.');
        }else if(!lastDecodedAt){
          const phase=m.phase==='configured'?'configuração recebida':'transmissor conectado';
          signal('Servidor confirma '+phase+'. Aguardando vídeo, sem afirmar que está ao vivo.');
          $('liveBadge').textContent='● CONECTANDO';
          updateControls('connecting');
        }
      }
      if(m.type==='relay-stats'){
        lastRelayAt=Number(m.lastFrameAt)||0;relayFrames=Number(m.frames)||0;
        if(isHostOnline&&!lastDecodedAt){
          signal(lastRelayAt
            ?'O servidor recebeu quadros, mas o player ainda não os decodificou. Confira mensagens de codec abaixo.'
            :'Transmissor conectado, mas ainda não chegaram quadros ao servidor. Confira FPS e status na guia do navegador.');
        }
      }
      if(m.type==='viewers')$('audience').textContent=m.count+' / '+room.limit+' espectadores';
      return;
    }
    const bytes=event.data;
    if(bytes.byteLength<10)return;
    const kind=new DataView(bytes).getUint8(0);
    if(kind===2){playAudio(bytes);return;}
    if(kind!==0&&kind!==1)return;
    if(!decoder||decoder.state!=='configured'){
      if(isHostOnline)signal('Chegaram dados de vídeo, mas o decodificador não está configurado.');
      return;
    }
    const view=new DataView(bytes);
    try{
      decoder.decode(new EncodedVideoChunk({type:kind===1?'key':'delta',timestamp:Number(view.getBigUint64(1)),data:bytes.slice(9)}));
    }catch(err){
      if(!String(err.message).includes('key frame'))feedback('Reiniciando sincronização de vídeo…');
    }
  };
  ws.onclose=event=>{
    active(false);$('network').textContent='Reconectando…';
    signal('Conexão da Activity interrompida ('+event.code+'). Tentando reconectar à sala.');
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
diagnosticTimer=setInterval(()=>{
  if(ws?.readyState!==WebSocket.OPEN||!room)return;
  ws.send(JSON.stringify({type:'sync'}));
  if(isHostOnline&&lastDecodedAt&&Date.now()-lastDecodedAt>4500){
    signal('Sem novos quadros há mais de 4 segundos. Confira se o navegador transmissor continua enviando FPS.');
    $('liveBadge').textContent='● SEM QUADROS';
  }
},4000);
window.addEventListener('beforeunload',()=>{
  closed=true;clearInterval(diagnosticTimer);ws?.close();decoder?.close();closeAudio();
});
setup();
