import {DiscordSDK} from '@discord/embedded-app-sdk';

const $=id=>document.getElementById(id);
const feedback=(msg)=>{$('feedback').textContent=msg;};
const canvas=$('video'),ctx=canvas.getContext('2d',{alpha:false});
let ws=null,decoder=null,room=null,online=false,frames=0,lastUpdate=performance.now(),retries=0,closed=false;
const sdk=new DiscordSDK('1569671744803967127');
const wsUrl=()=>`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/live/ws`;
const active=(value)=>{online=value;$('liveBadge').classList.toggle('active',value);$('liveBadge').textContent=value?'● AO VIVO':'● AGUARDANDO';$('video').parentNode.classList.toggle('streaming',value);if(!value){$('quality').textContent='Sem vídeo';$('video').width=1;$('video').height=1;}};
async function setup() {
  if(!window.VideoDecoder){feedback('Este navegador não suporta decodificação WebCodecs. Abra pelo Discord desktop atualizado.');return;}
  try{
    await Promise.race([sdk.ready(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Activity não iniciada no Discord')),10000))]);
    const instanceId=sdk.instanceId;
    if(!instanceId)throw Error('ID de sessão não disponível');
    const response=await fetch('/api/live/room',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instanceId})});
    const info=await response.json();
    if(!response.ok)throw Error(info.error||'Falha na sala');
    room=info;$('copyLink').disabled=false;
    $('copyLink').onclick=async()=>{
      try{await navigator.clipboard.writeText(room.broadcastUrl);feedback('Link de captura copiado. Abra no navegador do PC, fora do Discord.');}
      catch{feedback('Não foi possível copiar automaticamente. Verifique as permissões da área de transferência.');}
    };
    connect();
  }catch(err){$('network').textContent='Indisponível';feedback(`${err.message}. Habilite Activities e configure o mapeamento HTTPS no Developer Portal.`);}
}
function configure({codec,width,height,fps}){
  try{if(decoder){decoder.close();decoder=null;}
    decoder=new VideoDecoder({output(frame){
      if(canvas.width!==frame.displayWidth||canvas.height!==frame.displayHeight){canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;}
      ctx.drawImage(frame,0,0,canvas.width,canvas.height);frame.close();frames++;
      if(performance.now()-lastUpdate>1300){const elapsed=performance.now()-lastUpdate;$('quality').textContent=`${height}p · ${Math.round(frames*1000/elapsed)} FPS · ${codec.toUpperCase()}`;frames=0;lastUpdate=performance.now();}
    },error(error){feedback('Erro no decodificador: '+error.message);}});
    decoder.configure({codec,codedWidth:width,codedHeight:height,optimizeForLatency:true});
    active(true);
  }catch(e){feedback('Codec de vídeo incompatível: '+e.message);}
}
function connect(){if(!room||closed)return;
  ws=new WebSocket(wsUrl());ws.binaryType='arraybuffer';
  ws.onopen=()=>{retries=0;$('network').textContent='Conectado';ws.send(JSON.stringify({role:'viewer',roomId:room.roomId,token:room.viewerToken}));};
  ws.onmessage=event=>{
    if(typeof event.data==='string'){
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='config')configure(m);
      if(m.type==='status')active(Boolean(m.online));
      if(m.type==='viewers')$('audience').textContent=`${m.count} / ${room.limit} espectadores`;
      return;
    }
    if(!decoder||decoder.state!=='configured')return;
    const bytes=event.data;const view=new DataView(bytes);
    if(bytes.byteLength<12)return;
    try{decoder.decode(new EncodedVideoChunk({type:view.getUint8(0)===1?'key':'delta',timestamp:Number(view.getBigUint64(1)),data:bytes.slice(9)}));}
    catch(err){if(!String(err.message).includes('key frame'))feedback('Reiniciando sincronização de vídeo…');}
  };
  ws.onclose=()=>{active(false);$('network').textContent='Reconectando…';if(decoder){decoder.close();decoder=null;}if(!closed)setTimeout(connect,Math.min(8000,800*2**Math.min(retries++,4)));};
  ws.onerror=()=>{};
}
$('fullscreen').onclick=()=>{if(!document.fullscreenElement){$('video').parentNode.requestFullscreen?.().catch(()=>feedback('Tela cheia indisponível neste dispositivo.'));}else document.exitFullscreen?.();};
window.addEventListener('beforeunload',()=>{closed=true;ws?.close();decoder?.close();});
setup();
