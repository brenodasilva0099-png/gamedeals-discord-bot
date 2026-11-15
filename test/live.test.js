'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRooms,validInstance,safeEqual,MAX_VIEWERS,MAX_ROOMS}=require('../live/rooms');
const INSTANCE='1570000000000000000';
test('salas da Activity reutilizam a mesma sessão sem gerar códigos duplicados',()=>{
  const rs=createRooms();const a=rs.getOrCreate(INSTANCE),b=rs.getOrCreate(INSTANCE);
  assert.equal(a,b);assert.equal(a.viewerToken,b.viewerToken);assert.equal(rs.rooms.size,1);
});
test('tokens de transmissor e espectador são diferentes, longos e não intercambiáveis',()=>{
  const rs=createRooms(),room=rs.getOrCreate(INSTANCE);
  assert.match(room.hostToken,/^[a-zA-Z0-9_-]{32,128}$/);
  assert.notEqual(room.hostToken,room.viewerToken);
  assert.equal(rs.lookup(INSTANCE,room.hostToken,'host'),room);
  assert.equal(rs.lookup(INSTANCE,room.viewerToken,'viewer'),room);
  assert.equal(rs.lookup(INSTANCE,room.viewerToken,'host'),null);
  assert.equal(rs.lookup(INSTANCE,'wrong','host'),null);
  assert.equal(safeEqual('wrong','wrong'),false);
});
test('ID inválido não abre sessão',()=>{
  const rs=createRooms();assert.equal(validInstance('invalid'),false);
  assert.throws(()=>rs.getOrCreate('invalid'),/inválido/);
});
test('salas ociosas expiram e permitem nova sessão',()=>{
  let now=100000;const rs=createRooms(()=>now);
  const old=rs.getOrCreate(INSTANCE);now+=2*60*60*1000+1;rs.purge();
  assert.equal(rs.rooms.size,0);
  assert.notEqual(rs.getOrCreate(INSTANCE).hostToken,old.hostToken);
});
test('capacidade limitada de salas e espectadores',()=>{
  const rs=createRooms();assert.equal(MAX_VIEWERS,4);assert.equal(MAX_ROOMS,5);
  for(let i=0;i<MAX_ROOMS;i++)rs.getOrCreate(String(1570000000000000000n+BigInt(i)));
  assert.throws(()=>rs.getOrCreate('1570000000000011111'),/ocupadas/);
});

test('Activity oferece abertura pelo SDK e captura interna experimental com fallback manual',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'live/public/activity.html'),'utf8');
  const src=fs.readFileSync(path.join(root,'live/client-source.js'),'utf8');
  const broadcast=fs.readFileSync(path.join(root,'live/public/broadcast.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'live/public/broadcaster.js'),'utf8');
  assert.match(html,/id="openBrowser"/);
  assert.match(html,/id="streamHere"/);
  assert.match(html,/id="manualUrl"/);
  assert.match(src,/sdk\.commands\.openExternalLink\(\{url:room\.broadcastUrl\}\)/);
  assert.match(src,/target\.hash=new URL\(room\.broadcastUrl\)\.hash/);
  assert.match(src,/navigator\.clipboard\?\.writeText/);
  assert.match(broadcast,/id="backToActivity"/);
  assert.match(script,/fromActivity/);
  assert.match(script,/O Discord bloqueou a captura/);
});

test('Activity nao pode reutilizar JS antigo do cache apos deploy',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const {startLiveServer}=require('../live/server');
  const activity=fs.readFileSync(path.join(__dirname,'../live/public/activity.html'),'utf8');
  assert.ok(activity.includes('src="/live/client.js?v='));
  const broadcaster=fs.readFileSync(path.join(__dirname,'../live/public/broadcast.html'),'utf8');
  assert.ok(broadcaster.includes('src="/live/broadcaster.js?v='));
  const app=startLiveServer({port:0,logger:{info(){}}});
  await new Promise(resolve=>app.server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+app.server.address().port;
    const js=await fetch(base+'/live/client.js');
    assert.equal(js.status,200);
    assert.match(js.headers.get('cache-control')||'',/no-store/);
    const html=await fetch(base+'/live/');
    assert.match(html.headers.get('cache-control')||'',/no-store/);
    assert.match(await html.text(),/openBrowser/);
  }finally{
    await app.close();
  }
});
