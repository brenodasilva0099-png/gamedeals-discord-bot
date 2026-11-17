'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {startLiveServer}=require('../live/server');

test('worker recebe captura de tela independente do compositor com controle de fluxo',()=>{
  const worker=fs.readFileSync(path.join(__dirname,'../live/public/capture-worker.js'),'utf8');
  const broadcaster=fs.readFileSync(path.join(__dirname,'../live/public/broadcaster.js'),'utf8');
  assert.match(worker,/MediaStreamTrackProcessor/);
  assert.match(worker,/reader\.read\(\)/);
  assert.match(worker,/type:'frame'/);
  assert.match(worker,/type==='ack'/);
  assert.match(broadcaster,/new Worker\('\/live\/capture-worker.js/);
  assert.match(broadcaster,/captureWorker===worker/);
  assert.match(broadcaster,/video\.requestVideoFrameCallback\(videoFrame\)/);
  assert.match(broadcaster,/forceKeyframe=true/);
});

test('servidor entrega worker e repassa pedidos de keyframe somente ao transmissor selecionado',async()=>{
  const old=process.env.ACTIVITY_PUBLIC_URL;
  process.env.ACTIVITY_PUBLIC_URL='https://gamedeals.squareweb.app';
  const app=startLiveServer({port:0,logger:{info(){}}});
  await once(app.server,'listening');
  const port=app.server.address().port;
  const room=app.rooms.getOrCreate('1570000000000014567');
  const url='ws://127.0.0.1:'+port+'/live/ws';
  const create=()=>new WebSocket(url,{origin:'https://gamedeals.squareweb.app'});
  const host=create(),viewer=create();
  try{
    const response=await fetch('http://127.0.0.1:'+port+'/live/capture-worker.js');
    assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control')||'',/no-store/);
    assert.match(await response.text(),/MediaStreamTrackProcessor/);
    await Promise.all([once(host,'open'),once(viewer,'open')]);
    const hostConnect=new Promise((resolve,reject)=>{
      host.on('message',function handler(raw,binary){if(binary)return;try{const m=JSON.parse(raw.toString());if(m.type==='connected'){host.off('message',handler);resolve(m);}}catch{}});
      setTimeout(()=>reject(Error('Timeout host')),3000);
    });
    host.send(JSON.stringify({role:'host',roomId:room.instanceId,token:room.hostToken}));
    await hostConnect;
    const viewerConnect=new Promise((resolve,reject)=>{
      viewer.on('message',function handler(raw,binary){if(binary)return;try{const m=JSON.parse(raw.toString());if(m.type==='connected'){viewer.off('message',handler);resolve(m);}}catch{}});
      setTimeout(()=>reject(Error('Timeout viewer')),3000);
    });
    viewer.send(JSON.stringify({role:'viewer',roomId:room.instanceId,token:room.viewerToken}));
    await viewerConnect;
    const keyframe=new Promise((resolve,reject)=>{
      host.on('message',function handler(raw,binary){if(binary)return;try{const m=JSON.parse(raw.toString());if(m.type==='keyframe'){host.off('message',handler);resolve(m);}}catch{}});
      setTimeout(()=>reject(Error('Timeout keyframe')),3000);
    });
    viewer.send(JSON.stringify({type:'request-keyframe'}));
    await keyframe;
  }finally{
    host.terminate();viewer.terminate();await app.close();
    if(old===undefined)delete process.env.ACTIVITY_PUBLIC_URL;
    else process.env.ACTIVITY_PUBLIC_URL=old;
  }
});
