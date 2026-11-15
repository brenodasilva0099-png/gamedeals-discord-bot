'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {startLiveServer}=require('../live/server');

function awaitMessage(ws,check,timeout=5000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off('message',onMessage);reject(Error('Mensagem WebSocket nao recebida'));},timeout);
    function onMessage(data,isBinary){
      let value=data;
      if(!isBinary){try{value=JSON.parse(data.toString());}catch{return;}}
      if(!check(value,isBinary))return;
      clearTimeout(timer);ws.off('message',onMessage);resolve(value);
    }
    ws.on('message',onMessage);
  });
}
const hello=(ws,role,room,token)=>{
  const connected=awaitMessage(ws,m=>m.type==='connected'&&m.role===role);
  ws.send(JSON.stringify({role,roomId:room.instanceId,token}));
  return connected;
};
test('varios transmissores: cada espectador seleciona uma tela independente',async()=>{
  const before=process.env.ACTIVITY_PUBLIC_URL;
  process.env.ACTIVITY_PUBLIC_URL='https://gamedeals.squareweb.app';
  const app=startLiveServer({port:0,logger:{info(){}}});
  await once(app.server,'listening');
  const room=app.rooms.getOrCreate('1570000000000001234');
  const addr='ws://127.0.0.1:'+app.server.address().port+'/live/ws';
  const create=()=>new WebSocket(addr,{origin:'https://gamedeals.squareweb.app'});
  const hostA=create(),hostB=create(),viewerA=create(),viewerB=create();
  const all=[hostA,hostB,viewerA,viewerB];
  try{
    await Promise.all(all.map(ws=>once(ws,'open')));
    const a=await hello(hostA,'host',room,room.hostToken);
    const b=await hello(hostB,'host',room,room.hostToken);
    assert.notEqual(a.streamId,b.streamId);
    assert.equal(room.streams.size,2);

    const listA=awaitMessage(viewerA,m=>m.type==='stream-list'&&m.streams.length===2);
    await hello(viewerA,'viewer',room,room.viewerToken);
    const choiceA=await listA;
    assert.equal(choiceA.selectedStreamId,a.streamId);
    assert.equal(choiceA.streams[0].label,'Tela 1');

    const listB=awaitMessage(viewerB,m=>m.type==='stream-list'&&m.streams.length===2);
    await hello(viewerB,'viewer',room,room.viewerToken);
    assert.equal((await listB).selectedStreamId,a.streamId);

    const rename=awaitMessage(viewerA,m=>m.type==='stream-list'&&m.streams.some(s=>s.id===b.streamId&&s.label==='Jogo da Ana'));
    hostB.send(JSON.stringify({type:'label',label:'Jogo da Ana'}));
    assert.equal((await rename).streams.find(s=>s.id===b.streamId).label,'Jogo da Ana');

    const selectedB=awaitMessage(viewerB,m=>m.type==='stream-selected'&&m.streamId===b.streamId);
    viewerB.send(JSON.stringify({type:'select-stream',streamId:b.streamId}));
    await selectedB;

    const configA=awaitMessage(viewerA,m=>m.type==='config'&&m.width===1280);
    const configB=awaitMessage(viewerB,m=>m.type==='config'&&m.width===1920);
    hostA.send(JSON.stringify({type:'config',codec:'vp8',width:1280,height:720,fps:30,audio:false}));
    hostB.send(JSON.stringify({type:'config',codec:'vp8',width:1920,height:1080,fps:30,audio:false}));
    await Promise.all([configA,configB]);

    const binaryA=[],binaryB=[];
    const noteA=(message,isBinary)=>{if(isBinary)binaryA.push(message[9]);};
    const noteB=(message,isBinary)=>{if(isBinary)binaryB.push(message[9]);};
    viewerA.on('message',noteA);
    viewerB.on('message',noteB);
    const nextA=awaitMessage(viewerA,(m,isBinary)=>isBinary&&m[9]===65);
    const nextB=awaitMessage(viewerB,(m,isBinary)=>isBinary&&m[9]===66);
    const frameA=Buffer.alloc(32);frameA[0]=1;frameA[9]=65;
    const frameB=Buffer.alloc(32);frameB[0]=1;frameB[9]=66;
    hostA.send(frameA,{binary:true});
    hostB.send(frameB,{binary:true});
    await Promise.all([nextA,nextB]);
    await new Promise(resolve=>setTimeout(resolve,50));
    viewerA.off('message',noteA);viewerB.off('message',noteB);
    assert.deepEqual(binaryA,[65],'espectador A so deve receber stream A');
    assert.deepEqual(binaryB,[66],'espectador B so deve receber stream B');

    const unknown=awaitMessage(viewerA,m=>m.type==='stream-error');
    viewerA.send(JSON.stringify({type:'select-stream',streamId:'id-inexistente'}));
    assert.match((await unknown).error,/não está mais disponível/);

    const switched=awaitMessage(viewerB,m=>m.type==='stream-selected'&&m.streamId===a.streamId);
    hostB.close();
    await switched;
    assert.equal(room.streams.size,1);
    assert.equal(viewerB.selectedStreamId,a.streamId);
    assert.equal(viewerA.selectedStreamId,a.streamId);
  }finally{
    for(const ws of all)ws.terminate();
    await app.close();
    if(before===undefined)delete process.env.ACTIVITY_PUBLIC_URL;
    else process.env.ACTIVITY_PUBLIC_URL=before;
  }
});
test('Activity tem seletor de transmissões e transmissor permite escolher nome',()=>{
  const fs=require('node:fs');
  const activity=fs.readFileSync(require('node:path').join(__dirname,'../live/public/activity.html'),'utf8');
  const client=fs.readFileSync(require('node:path').join(__dirname,'../live/client-source.js'),'utf8');
  const broadcast=fs.readFileSync(require('node:path').join(__dirname,'../live/public/broadcast.html'),'utf8');
  const broadcaster=fs.readFileSync(require('node:path').join(__dirname,'../live/public/broadcaster.js'),'utf8');
  assert.match(activity,/id="streamPicker"/);
  assert.match(client,/type:'select-stream'/);
  assert.match(client,/type==='stream-list'/);
  assert.match(client,/switchStream\(m\.streamId/);
  assert.match(broadcast,/id="streamName"/);
  assert.match(broadcaster,/type:'label'/);
});
