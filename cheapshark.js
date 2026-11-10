'use strict';
const crypto=require('node:crypto');
const API='https://www.cheapshark.com/api/1.0';
const USER_AGENT='GameDealsDiscordBot/0.4 (+https://github.com/brenodasilva0099-png/gamedeals-discord-bot)';
// Nomes de revendedores conhecidos e autorizados. A lista ativa e obtida da API, nunca inventada.
const AUTHORIZED=Object.freeze({
  greenmangaming:'Green Man Gaming',
  fanatical:'Fanatical',
  gog:'GOG',
  humblestore:'Humble Store',
  gamesplanet:'Gamesplanet',
  gamebillet:'GameBillet',
  gamersgate:'GamersGate',
  wingamestore:'WinGameStore',
  indiegala:'IndieGala',
  voidu:'Voidu',
  dlgamer:'DLGamer'
});
const STORE_CACHE_MS=24*60*60*1000;
const QUERY_CACHE_MS=15*60*1000;
const BROWSE_CACHE_MS=4*60*60*1000;
const cache=new Map();
let nextAllowed=0;
let blockedUntil=0;
const storeKey=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const sourceName=source=>source?.startsWith('cs:')?(AUTHORIZED[source.slice(3)]||'Loja parceira'):null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function getJson(url){
  if(Date.now()<blockedUntil)throw Error('CheapShark em limite temporario de consultas. Tente mais tarde.');
  const wait=Math.max(0,nextAllowed-Date.now());if(wait)await sleep(wait);
  nextAllowed=Date.now()+1800;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14000);
  try{
    const response=await fetch(url,{signal:ctrl.signal,headers:{'Accept':'application/json','User-Agent':USER_AGENT}});
    if(response.status===429){
      const retry=Math.max(60,Math.min(3600,Number(response.headers.get('Retry-After'))||900));
      blockedUntil=Date.now()+retry*1000;
      throw Error(`CheapShark limitou consultas (HTTP 429). Pausa de ${retry}s.`);
    }
    if(!response.ok)throw Error(`CheapShark retornou HTTP ${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}
async function cached(key,ttl,producer){
  const hit=cache.get(key);
  if(hit && hit.until>Date.now())return hit.value;
  // Armazena promessa imediatamente, impedindo pedidos repetidos para mesma pesquisa.
  const value=Promise.resolve().then(producer);
  cache.set(key,{value,until:Date.now()+ttl});
  try{return await value;}catch(e){cache.delete(key);throw e;}
}
async function allowedStores(){
  return cached('active-stores',STORE_CACHE_MS,async()=>{
    const data=await getJson(`${API}/stores`);
    if(!Array.isArray(data))throw Error('Formato inesperado da lista de lojas CheapShark');
    return data.filter(x=>(x.isActive===true || String(x.isActive)==='1') && AUTHORIZED[storeKey(x.storeName)] && /^\d+$/.test(String(x.storeID)))
      .map(x=>({id:String(x.storeID),slug:storeKey(x.storeName),name:AUTHORIZED[storeKey(x.storeName)]}));
  });
}
function usdCents(value){
  const raw=String(value??'');
  if(!/^(?:\d{1,8})(?:\.\d{1,2})?$/.test(raw))return null;
  const number=Math.round(Number(raw)*100);
  return Number.isSafeInteger(number)?number:null;
}
function normalizeDeal(deal,storeMap){
  if(!deal || typeof deal.dealID!=='string' || deal.dealID.length<8 || deal.dealID.length>200)return null;
  const store=storeMap.get(String(deal.storeID));
  if(!store || !deal.title)return null;
  const price=usdCents(deal.salePrice),original=usdCents(deal.normalPrice);
  if(price===null || original===null || price<=0 || price>=original)return null;
  const hash=crypto.createHash('sha256').update(deal.dealID).digest('hex').slice(0,24);
  const key=`cs:${store.slug}:${hash}`;
  const steamId=String(deal.steamAppID||'');
  const img=/^[1-9]\d{0,9}$/.test(steamId)
    ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/header.jpg`
    : (typeof deal.thumb==='string' && /^https:\/\//i.test(deal.thumb) ? deal.thumb:null);
  const disc=Math.max(0,Math.min(100,Math.round((1-price/original)*100)));
  return {key,source:`cs:${store.slug}`,title:String(deal.title).slice(0,180),kind:'app',
    url:`https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(deal.dealID)}`,
    image:img,currency:'USD',priceCents:price,originalCents:original,discount:disc,expiresAt:null};
}
async function requestDeals(params){
  const active=await allowedStores();
  if(!active.length)throw Error('Nenhuma loja verificada disponível no CheapShark agora');
  const storeMap=new Map(active.map(s=>[s.id,s]));
  params.set('storeID',active.map(x=>x.id).join(','));
  const list=await getJson(`${API}/deals?${params.toString()}`);
  if(!Array.isArray(list))throw Error('Formato inesperado das ofertas CheapShark');
  return list.map(x=>normalizeDeal(x,storeMap)).filter(Boolean);
}
async function featured(){
  return cached('featured',BROWSE_CACHE_MS,()=>requestDeals(new URLSearchParams({onSale:'1',pageSize:'35',pageNumber:'0',sortBy:'DealRating'})));
}
async function searchByTitle(title){
  const clean=String(title||'').trim().slice(0,80);
  if(clean.length<2)return [];
  return cached('title:'+clean.toLowerCase(),QUERY_CACHE_MS,()=>requestDeals(new URLSearchParams({title:clean,pageSize:'40',pageNumber:'0',sortBy:'DealRating'})));
}
module.exports={AUTHORIZED,storeKey,sourceName,usdCents,normalizeDeal,allowedStores,featured,searchByTitle};