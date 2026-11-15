'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRooms,validInstance} = require('./rooms');

const ROOT=path.join(__dirname,'public');
const PORT=Number(process.env.PORT)||3000;
const CLIENT_ID=process.env.DISCORD_APPLICATION_ID||'1569671744803967127';
const MAX_JSON=2048;
const HTTP_CACHE=new Map();
function readJson(req) {return new Promise((resolve,reject)=>{
  let body='', size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>MAX_JSON){reject(Error('Requisição muito grande'));req.destroy();return;}body+=chunk;});
  req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(Error('JSON inválido'));}});
  req.on('error',reject);
});}
function json(res,status,body) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
function html(res,file) {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'display-capture=(self)'});res.end(fs.readFileSync(path.join(ROOT,file)));}
// A Activity e o broadcaster mudam a cada deploy. Nao permitir JS antigo cacheado
// com HTML novo: isso pode deixar apenas o botao Copiar link habilitado.
function asset(res,file,type) {res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(ROOT,file)));}
async function verifyActivityInstance(id) {
  if(process.env.LIVE_ALLOW_UNVERIFIED === '1')return true; // apenas desenvolvimento LOCAL
  const hit=HTTP_CACHE.get(id);
  if(hit && hit.expires>Date.now())return hit.valid;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
  try{
    const response=await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}/activity-instances/${encodeURIComponent(id)}`,{
      headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN||''}`},signal:controller.signal});
    const valid=response.status===200;
    HTTP_CACHE.set(id,{valid,expires:Date.now()+(valid?90_000:10_000)});
    if(HTTP_CACHE.size>300)HTTP_CACHE.clear();
    return valid;
  }catch{return false;}finally{clearTimeout(timer);}
}
function startLiveServer({port=PORT,logger=console}={}) {
  const {WebSocketServer,WebSocket}=require('ws');
  const rooms=createRooms();
  const server=http.createServer(async (req,res)=>{
    const pathname=new URL(req.url,'http://local.invalid').pathname;
    if(req.method==='GET'){
      if(pathname==='/health')return json(res,200,{ok:true,service:'GameDeals',live:true});
      if(pathname==='/' || pathname==='/live' || pathname==='/live/')return html(res,'activity.html');
      if(pathname==='/live/broadcast')return html(res,'broadcast.html');
      if(pathname==='/live/styles.css')return asset(res,'styles.css','text/css; charset=utf-8');
      if(pathname==='/live/quality.js')return asset(res,'quality.js','application/javascript; charset=utf-8');
      if(pathname==='/live/client.js')return asset(res,'client.js','application/javascript; charset=utf-8');
      if(pathname==='/live/broadcaster.js')return asset(res,'broadcaster.js','application/javascript; charset=utf-8');
    }
    if(req.method==='POST' && pathname==='/api/live/room'){
      try {
        const {instanceId}=await readJson(req);
        if(!validInstance(instanceId))return json(res,400,{error:'Sala inválida'});
        if(!await verifyActivityInstance(instanceId))return json(res,403,{error:'Esta sessão não está ativa no Discord. Verifique a configuração da Activity.'});
        const room=rooms.getOrCreate(instanceId);
        const origin=(process.env.ACTIVITY_PUBLIC_URL||`https://${req.headers.host||'localhost'}`).replace(/\/$/,'');
        // O token do transmissor aparece apenas no fragmento da URL (nunca enviado via HTTP).
        return json(res,200,{roomId:room.instanceId,viewerToken:room.viewerToken,
          broadcastUrl:`${origin}/live/broadcast#room=${encodeURIComponent(room.instanceId)}&key=${encodeURIComponent(room.hostToken)}`,
          online:!!room.broadcaster,viewers:room.viewers.size,limit:rooms.MAX_VIEWERS});
      } catch(e){return json(res,400,{error:e.message});}
    }
    return json(res,404,{error:'Rota não encontrada'});
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:rooms.MAX_FRAME_BYTES+64,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const pathname=new URL(req.url,'http://local.invalid').pathname;
    if(pathname!=='/live/ws')return socket.destroy();
    const origin=req.headers.origin||'';
    const expected=(process.env.ACTIVITY_PUBLIC_URL||'').replace(/\/$/,'');
    const isDiscord=/^https:\/\/[0-9]+\.discordsays\.com$/.test(origin);
    const isHost=origin===expected || origin===`https://${req.headers.host}` || (process.env.LIVE_ALLOW_UNVERIFIED==='1' && /^http:\/\/localhost(?::\d+)?$/.test(origin));
    if(!isDiscord && !isHost)return socket.destroy();
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  const emit=(ws,obj)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));};
  const streamSummary=room=>[...room.streams.values()].map(s=>({
    id:s.id,label:s.label,online:!!s.config,phase:s.config?(s.lastFrameAt?'receiving':'configured'):'connecting'
  }));
  function sendStreamList(room){
    const items=streamSummary(room);
    for(const v of room.viewers)emit(v,{type:'stream-list',streams:items,selectedStreamId:v.selectedStreamId||null});
  }
  function audienceCount(room){
    for(const s of room.streams.values())emit(s.ws,{type:'viewers',count:room.viewers.size});
    for(const v of room.viewers)emit(v,{type:'viewers',count:room.viewers.size});
  }
  function selectedStream(room,viewer){
    return viewer.selectedStreamId?room.streams.get(viewer.selectedStreamId):null;
  }
  function notifySelection(viewer,room,{requestKeyframe=false}={}){
    const s=selectedStream(room,viewer);
    emit(viewer,{type:'stream-selected',streamId:s?.id||null});
    emit(viewer,{type:'status',online:!!s,phase:!s?'idle':!s.config?'connecting':s.lastFrameAt?'receiving':'configured',viewers:room.viewers.size});
    if(s?.config)emit(viewer,{type:'config',...s.config});
    if(s)emit(viewer,{type:'relay-stats',frames:s.framesIn||0,lastFrameAt:s.lastFrameAt||0,viewers:room.viewers.size});
    if(s&&requestKeyframe)emit(s.ws,{type:'keyframe'});
  }
  function notifySelected(room,streamId,payload){
    for(const viewer of room.viewers){
      if(viewer.selectedStreamId===streamId)emit(viewer,payload);
    }
  }
  function connectHost(ws,room){
    if(room.streams.size>=rooms.MAX_STREAMS)return ws.close(1008,'Limite de transmissões simultâneas');
    const id=crypto.randomBytes(8).toString('hex');
    const label='Tela '+(++room.streamSerial);
    const source={id,label,ws,config:null,lastFrameAt:0,framesIn:0,bytesIn:0};
    ws.source=source;room.streams.set(id,source);
    room.broadcaster=room.streams.values().next().value?.ws||null; // compatibilidade com sala legada
    emit(ws,{type:'connected',role:'host',room:room.instanceId.slice(-6),streamId:id,label});
    emit(ws,{type:'viewers',count:room.viewers.size});
    for(const v of room.viewers){
      if(!v.selectedStreamId){v.selectedStreamId=id;notifySelection(v,room,{requestKeyframe:true});}
    }
    sendStreamList(room);
  }
  function connectViewer(ws,room){
    if(room.viewers.size>=rooms.MAX_VIEWERS)return ws.close(1008,'Limite de espectadores atingido');
    room.viewers.add(ws);
    ws.selectedStreamId=room.streams.keys().next().value||null;
    emit(ws,{type:'connected',role:'viewer',room:room.instanceId.slice(-6)});
    sendStreamList(room);
    notifySelection(ws,room,{requestKeyframe:true});
    audienceCount(room);
  }
  wss.on('connection',ws=>{
    let room=null,role=null;
    ws.isAlive=true;
    ws.on('pong',()=>{ws.isAlive=true;});
    ws.on('message',(data,isBinary)=>{
      if(!room){
        if(isBinary)return ws.close(1008,'Protocolo inválido');
        let hello;try{hello=JSON.parse(data.toString());}catch{return ws.close(1008,'JSON inválido');}
        role=hello.role==='host'?'host':hello.role==='viewer'?'viewer':null;
        if(!role)return ws.close(1008,'Papel inválido');
        room=rooms.lookup(hello.roomId,hello.token,role);
        if(!room)return ws.close(1008,'Sessão inválida ou expirada');
        if(role==='host')connectHost(ws,room);else connectViewer(ws,room);
        return;
      }
      room.lastAccess=Date.now();
      if(role==='viewer'){
        if(isBinary)return;
        let m;try{m=JSON.parse(data.toString());}catch{return;}
        if(m.type==='sync'){
          sendStreamList(room);
          notifySelection(ws,room);
        }
        if(m.type==='select-stream'&&typeof m.streamId==='string'){
          if(!room.streams.has(m.streamId))return emit(ws,{type:'stream-error',error:'Esta transmissão não está mais disponível.'});
          ws.selectedStreamId=m.streamId;
          notifySelection(ws,room,{requestKeyframe:true});
          sendStreamList(room);
        }
        return;
      }
      const source=ws.source;
      if(!source||room.streams.get(source.id)!==source)return;
      if(isBinary){
        if(!source.config||data.byteLength>rooms.MAX_FRAME_BYTES||data.byteLength<10)return;
        const kind=data[0];
        if(kind!==0&&kind!==1&&kind!==2)return;
        if(kind===2&&!source.config.audio)return;
        if(kind===0||kind===1){
          source.framesIn++;source.bytesIn+=data.byteLength;source.lastFrameAt=Date.now();
          if(source.framesIn===1)notifySelected(room,source.id,{type:'status',online:true,phase:'receiving'});
        }
        for(const v of room.viewers){
          if(v.selectedStreamId===source.id&&v.readyState===WebSocket.OPEN&&v.bufferedAmount<rooms.MAX_BUFFERED)v.send(data,{binary:true});
        }
        return;
      }
      let message;try{message=JSON.parse(data.toString());}catch{return;}
      if(message.type==='label'&&typeof message.label==='string'){
        const label=message.label.trim().slice(0,48);
        if(label){source.label=label;sendStreamList(room);}
        return;
      }
      if(message.type==='config'
        && ['vp8','avc1.640033','avc1.42E01E'].includes(message.codec)
        && Number.isInteger(message.height)&&message.height>=180&&message.height<=1440&&message.height%2===0
        && Number.isInteger(message.width)&&message.width>=320&&message.width<=2560&&message.width%2===0
        && [15,30,60].includes(message.fps)
        && [false,true,undefined].includes(message.audio)
        && (!message.audio||[44100,48000].includes(message.audioSampleRate))){
        source.config={codec:message.codec,width:message.width,height:message.height,fps:message.fps,
          audio:message.audio===true,audioSampleRate:message.audio===true?message.audioSampleRate:0};
        source.framesIn=0;source.bytesIn=0;source.lastFrameAt=0;
        notifySelected(room,source.id,{type:'config',...source.config});
        notifySelected(room,source.id,{type:'status',online:true,phase:'configured'});
        emit(ws,{type:'config-ack',...source.config});
        sendStreamList(room);
      }else if(message.type==='config'){
        emit(ws,{type:'config-error',error:'O servidor rejeitou codec, resolução, FPS ou áudio. Tente 720p/30 sem áudio para diagnosticar.'});
      }
      if(message.type==='stop'){
        source.config=null;source.lastFrameAt=0;
        notifySelected(room,source.id,{type:'status',online:false,phase:'idle'});
        sendStreamList(room);
      }
    });
    ws.on('close',()=>{
      if(!room)return;
      if(role==='viewer'){
        room.viewers.delete(ws);audienceCount(room);
      }
      if(role==='host'&&ws.source&&room.streams.get(ws.source.id)===ws.source){
        const removed=ws.source.id;
        room.streams.delete(removed);
        room.broadcaster=room.streams.values().next().value?.ws||null;
        const next=room.streams.keys().next().value||null;
        for(const v of room.viewers){
          if(v.selectedStreamId===removed){
            v.selectedStreamId=next;
            notifySelection(v,room,{requestKeyframe:true});
          }
        }
        sendStreamList(room);
      }
    });
    ws.on('error',()=>{});
  });
  const metrics=setInterval(()=>{
    for(const room of rooms.rooms.values()){
      for(const source of room.streams.values()){
        const report={type:'relay-stats',frames:source.framesIn,bytes:source.bytesIn,lastFrameAt:source.lastFrameAt,viewers:room.viewers.size};
        emit(source.ws,report);
        notifySelected(room,source.id,report);
        source.framesIn=0;source.bytesIn=0;
      }
    }
  },2000);
  metrics.unref?.();
  const upkeep=setInterval(()=>{
    rooms.purge();for(const ws of wss.clients){if(ws.isAlive===false){ws.terminate();continue;}ws.isAlive=false;ws.ping();}
  },30_000);
  upkeep.unref?.();
  server.listen(port,'0.0.0.0',()=>logger.info?.(`GameDeals Live: HTTP/WebSocket em 0.0.0.0:${port}`));
  server.on('close',()=>{clearInterval(upkeep);clearInterval(metrics);});
  return {server,wss,rooms,close:()=>new Promise(resolve=>{for(const ws of wss.clients)ws.terminate();wss.close(()=>server.close(resolve));})};
}
module.exports={startLiveServer,verifyActivityInstance};
