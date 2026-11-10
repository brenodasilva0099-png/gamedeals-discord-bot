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
