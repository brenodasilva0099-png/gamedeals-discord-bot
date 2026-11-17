'use strict';
const crypto=require('node:crypto');
function validOffer(offer,now=Date.now()){
  if(!offer)return false;
  const price=Number(offer.priceCents??offer.price_cents);
  const original=Number(offer.originalCents??offer.original_cents);
  if(!Number.isInteger(price)||price<0||!Number.isFinite(original)||original<0)return false;
  if(!(Number(offer.discount)>0)||price===0&&original<=0)return false;
  const end=offer.expiresAt||offer.expires_at;
  if(end&&(!Number.isFinite(Date.parse(end))||Date.parse(end)<=now))return false;
  return true;
}
function eligibleGuild(offer,guild,now=Date.now()){
  if(!guild?.enabled||!validOffer(offer,now))return false;
  const price=Number(offer.priceCents??offer.price_cents);
  if(price!==0&&Number(offer.discount)<Number(guild.min_discount||0))return false;
  if(guild.max_price_cents!=null&&(offer.currency!=='BRL'||price>guild.max_price_cents))return false;
  return true;
}
function queueId(type,target,offer,changedAt){
  return crypto.createHash('sha256').update([type,target,offer,changedAt].join('\0')).digest('hex');
}
function retryDelay(attempt){
  return Math.min(6*3600000,30000*2**Math.max(0,Math.min(6,attempt-1)));
}
function normalizeTitle(title){
  return String(title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}
function gameKey(offer){
  const title=normalizeTitle(offer.title),kind=offer.kind||'app';
  return title.length>=2&&title.length<=150?kind+':'+title:null;
}
function storeClass(source){
  if(source==='steam')return 'steam';
  if(source==='epic')return 'epic';
  if(String(source).startsWith('cs:'))return 'partners';
  return 'other';
}
function orderOffers(offers,sort='relevance',currency='all',saleOnly=false){
  let list=offers.filter(o=>(currency==='all'||o.currency===currency)&&(!saleOnly||validOffer(o)));
  if(sort==='discount')list.sort((a,b)=>Number(b.discount)-Number(a.discount));
  else if(sort==='price')list.sort((a,b)=>String(a.currency).localeCompare(String(b.currency))||(a.priceCents??a.price_cents)-(b.priceCents??b.price_cents));
  return list;
}
module.exports={validOffer,eligibleGuild,queueId,retryDelay,normalizeTitle,gameKey,storeClass,orderOffers};
