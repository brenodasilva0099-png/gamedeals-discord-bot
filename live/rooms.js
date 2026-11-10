'use strict';
const crypto = require('node:crypto');

const MAX_ROOMS = 5;
const MAX_VIEWERS = 4;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_BUFFERED = 1024 * 1024;
const ROOM_TTL = 2 * 60 * 60 * 1000;
const randomToken = () => crypto.randomBytes(24).toString('base64url');
const validInstance = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{12,128}$/.test(id);
const validToken = t => typeof t === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(t);
function safeEqual(a,b) {
  if (!validToken(a) || !validToken(b)) return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x,y);
}
function createRooms(now=()=>Date.now()) {
  const rooms=new Map();
  function purge() {
    for (const [id,room] of rooms) {
      if (now()-room.lastAccess>ROOM_TTL) {
        room.broadcaster?.close(1001,'Sessão expirada');
        for(const viewer of room.viewers) viewer.close(1001,'Sessão expirada');
        rooms.delete(id);
      }
    }
  }
  function getOrCreate(id) {
    if(!validInstance(id)) throw Error('ID de Activity inválido');
    purge();
    let room=rooms.get(id);
    if(!room) {
      if(rooms.size>=MAX_ROOMS)throw Error('Todas as salas estão ocupadas');
      room={instanceId:id,viewerToken:randomToken(),hostToken:randomToken(),broadcaster:null,viewers:new Set(),config:null,lastAccess:now(),created:now()};
      rooms.set(id,room);
    }
    room.lastAccess=now();
    return room;
  }
  function lookup(id,token,role) {
    const room=rooms.get(id);
    if(!room)return null;
    const ok=safeEqual(token,role==='host'?room.hostToken:room.viewerToken);
    if(ok)room.lastAccess=now();
    return ok?room:null;
  }
  return {rooms,getOrCreate,lookup,purge,MAX_VIEWERS,MAX_FRAME_BYTES,MAX_BUFFERED};
}
module.exports={createRooms,validInstance,safeEqual,MAX_ROOMS,MAX_VIEWERS,MAX_FRAME_BYTES};
