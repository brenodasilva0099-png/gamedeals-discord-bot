'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {dimensions,bitrate}=require('../live/public/quality.js');
const {startLiveServer}=require('../live/server');

test('1080p e 1440p usam a resolucao da fonte sem upscale artificial',()=>{
  assert.deepEqual(dimensions(1920,1080,1080),{width:1920,height:1080,native:true});
  assert.deepEqual(dimensions(2560,1440,1440),{width:2560,height:1440,native:true});
  assert.deepEqual(dimensions(1920,1080,1440),{width:1920,height:1080,native:true});
  assert.deepEqual(dimensions(2560,1440,1080),{width:1920,height:1080,native:false});
  const ultrawide=dimensions(3440,1440,1440);
  assert.equal(ultrawide.width,2560);
  assert.ok(ultrawide.height<1440);
  assert.ok(bitrate(2560,1440,60)>bitrate(1920,1080,30));
  assert.throws(()=>dimensions(1920,1080,2160),/inválida/);
  assert.throws(()=>bitrate(1920,1080,120),/inválido/);
});
function awaitMessage(ws,predicate,timeout=5000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off('message',onMsg);reject(Error('Sem mensagem WebSocket esperada'));},timeout);
    function onMsg(data,isBinary){
      let val=data;
      if(!isBinary){try{val=JSON.parse(data.toString());}catch{return;}}
      if(!predicate(val,isBinary))return;
      clearTimeout(timer);ws.off('message',onMsg);resolve(val);
    }
    ws.on('message',onMsg);
  });
}
test('servidor aceita 1440p a 60 FPS e encaminha audio PCM real opcional',async()=>{
  const previous=process.env.ACTIVITY_PUBLIC_URL;
  process.env.ACTIVITY_PUBLIC_URL='https://gamedeals.squareweb.app';
  const app=startLiveServer({port:0,logger:{info(){}}});
  await once(app.server,'listening');
  const room=app.rooms.getOrCreate('1570000000000000000');
  const url='ws://127.0.0.1:'+app.server.address().port+'/live/ws';
  const origin='https://gamedeals.squareweb.app';
  const host=new WebSocket(url,{origin});
  const viewer=new WebSocket(url,{origin});
  try{
    await Promise.all([once(host,'open'),once(viewer,'open')]);
    const hostReady=awaitMessage(host,val=>val.type==='connected');
    host.send(JSON.stringify({role:'host',roomId:room.instanceId,token:room.hostToken}));
    await hostReady;
    const viewerReady=awaitMessage(viewer,val=>val.type==='connected');
    viewer.send(JSON.stringify({role:'viewer',roomId:room.instanceId,token:room.viewerToken}));
    await viewerReady;
    const gotConfig=awaitMessage(viewer,val=>val.type==='config');
    host.send(JSON.stringify({type:'config',codec:'vp8',width:2560,height:1440,fps:60,audio:true,audioSampleRate:48000}));
    const config=await gotConfig;
    assert.deepEqual({width:config.width,height:config.height,fps:config.fps,audio:config.audio},{
      width:2560,height:1440,fps:60,audio:true});
    const audioPacket=new Uint8Array(9+2048*2);
    audioPacket[0]=2;
    const gotAudio=awaitMessage(viewer,(val,isBinary)=>isBinary&&val[0]===2);
    host.send(audioPacket);
    const audio=await gotAudio;
    assert.equal(audio.length,audioPacket.byteLength);
    const gotConfig2=awaitMessage(viewer,val=>val.type==='config');
    host.send(JSON.stringify({type:'config',codec:'vp8',width:1920,height:1080,fps:60,audio:false}));
    const config2=await gotConfig2;
    assert.equal(config2.audio,false);
    const gotVideo=awaitMessage(viewer,(val,isBinary)=>isBinary&&val[0]===1);
    const video=new Uint8Array(64);video[0]=1;
    host.send(video);
    const packet=await gotVideo;
    assert.equal(packet.length,64);
  }finally{
    host.terminate();viewer.terminate();await app.close();
    if(previous===undefined)delete process.env.ACTIVITY_PUBLIC_URL;else process.env.ACTIVITY_PUBLIC_URL=previous;
  }
});
test('fluxo de seleção separa consentimento de captura e inicio da transmissão',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../live/public/broadcast.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../live/public/broadcaster.js'),'utf8');
  const activity=fs.readFileSync(path.join(__dirname,'../live/public/activity.html'),'utf8');
  for(const field of ['selectSource','start','framerate','resolution','audioMode'])assert.ok(html.includes('id="'+field+'"'));
  for(const value of ['1440','1080','60','system','none'])assert.ok(html.includes('value="'+value+'"'));
  assert.ok(js.includes('getDisplayMedia('));
  assert.ok(js.includes('requestVideoFrameCallback'));
  assert.ok(js.includes('framesSent/delta'));
  assert.ok(js.includes('GDQuality.dimensions('));
  assert.ok(js.includes('createMediaStreamSource('));
  assert.ok(activity.includes('enableAudio'));
});

test('transmissor só anuncia ao vivo após ACK e espectador pode sincronizar sala',async()=>{
  const old=process.env.ACTIVITY_PUBLIC_URL;
  process.env.ACTIVITY_PUBLIC_URL='https://gamedeals.squareweb.app';
  const app=startLiveServer({port:0,logger:{info(){}}});
  await once(app.server,'listening');
  const room=app.rooms.getOrCreate('1570000000000000042');
  const url='ws://127.0.0.1:'+app.server.address().port+'/live/ws';
  const host=new WebSocket(url,{origin:'https://gamedeals.squareweb.app'});
  const viewer=new WebSocket(url,{origin:'https://gamedeals.squareweb.app'});
  try{
    await Promise.all([once(host,'open'),once(viewer,'open')]);
    const h=awaitMessage(host,m=>m.type==='connected');
    host.send(JSON.stringify({role:'host',roomId:room.instanceId,token:room.hostToken}));
    assert.equal((await h).room,room.instanceId.slice(-6));
    const v=awaitMessage(viewer,m=>m.type==='connected');
    viewer.send(JSON.stringify({role:'viewer',roomId:room.instanceId,token:room.viewerToken}));
    assert.equal((await v).room,room.instanceId.slice(-6));
    const ack=awaitMessage(host,m=>m.type==='config-ack');
    const cfg=awaitMessage(viewer,m=>m.type==='config');
    host.send(JSON.stringify({type:'config',codec:'vp8',width:1920,height:1080,fps:60,audio:false}));
    assert.equal((await ack).fps,60);
    assert.equal((await cfg).width,1920);
    const receives=awaitMessage(viewer,(m,b)=>b&&m[0]===1);
    const frame=Buffer.alloc(100);frame[0]=1;
    host.send(frame,{binary:true});
    assert.equal((await receives).length,100);
    const sync=awaitMessage(viewer,m=>m.type==='relay-stats');
    viewer.send(JSON.stringify({type:'sync'}));
    assert.equal((await sync).viewers,1);
    const error=awaitMessage(host,m=>m.type==='config-error');
    host.send(JSON.stringify({type:'config',codec:'fake',width:7000,height:4000,fps:120}));
    assert.match((await error).error,/rejeitou/);
  }finally{
    host.terminate();viewer.terminate();await app.close();
    if(old===undefined)delete process.env.ACTIVITY_PUBLIC_URL;else process.env.ACTIVITY_PUBLIC_URL=old;
  }
});
test('cliente só marca vídeo ativo depois de decodificar o primeiro quadro',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const client=fs.readFileSync(path.join(__dirname,'../live/client-source.js'),'utf8');
  const host=fs.readFileSync(path.join(__dirname,'../live/public/broadcaster.js'),'utf8');
  assert.match(client,/lastDecodedAt=Date\.now\(\)/);
  assert.match(client,/if\(!online\)\{active\(true\)/);
  assert.match(client,/type:'sync'/);
  assert.match(client,/type==='relay-stats'/);
  assert.match(host,/type==='config-ack'/);
  assert.match(host,/await accepted/);
  assert.match(host,/roomId/);
});

test('transmissor recebe quantidade de espectadores mesmo durante handshake',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const js=fs.readFileSync(path.join(__dirname,'../live/public/broadcaster.js'),'utf8');
  assert.ok(js.includes("if(msg.type==='viewers')viewersConnected=Number(msg.count)||0"));
  assert.ok(js.includes('describeRelay();'));
});
