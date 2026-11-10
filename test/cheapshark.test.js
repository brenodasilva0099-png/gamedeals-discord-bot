'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {usdCents,normalizeDeal,storeKey,sourceName}=require('../cheapshark');
const stores=new Map([['7',{slug:'greenmangaming',name:'Green Man Gaming'}],['8',{slug:'fanatical',name:'Fanatical'}]]);
const deal={dealID:'abcABC/123+=',storeID:'7',title:'Jogo de teste - Deluxe',salePrice:'9.99',normalPrice:'39.99',steamAppID:'222222',thumb:'https://example.com/cover.png'};
test('Preços USD viram centavos e não são convertidos para BRL',()=>{
 assert.equal(usdCents('9.99'),999);assert.equal(usdCents('39.99'),3999);assert.equal(usdCents('bad'),null);assert.equal(usdCents('-3'),null);
});
test('A API gera loja, link redirect e banner Steam sem falsificar preços',()=>{
 const o=normalizeDeal(deal,stores);
 assert.equal(o.source,'cs:greenmangaming');assert.equal(o.currency,'USD');
 assert.equal(o.priceCents,999);assert.equal(o.originalCents,3999);assert.equal(o.discount,75);
 assert.match(o.url,/^https:\/\/www\.cheapshark\.com\/redirect\?dealID=/);
 assert.match(o.image,/steam\/apps\/222222\/header\.jpg/);
 assert.ok(o.key.length<90);
});
test('Uma oferta é identificada por loja e dealID, sem colisão previsível',()=>{
 const a=normalizeDeal(deal,stores);
 const b=normalizeDeal({...deal,storeID:'8'},stores);
 assert.notEqual(a.key,b.key);assert.equal(normalizeDeal(deal,stores).key,a.key);
});
test('Ignora lojas não autorizadas, oferta sem desconto ou preço inválido',()=>{
 assert.equal(normalizeDeal({...deal,storeID:'999'},stores),null);
 assert.equal(normalizeDeal({...deal,salePrice:'39.99'},stores),null);
 assert.equal(normalizeDeal({...deal,dealID:'x'},stores),null);
 assert.equal(normalizeDeal({...deal,salePrice:'0'},stores),null);
});
test('Identifica nomes reais de lojas aprovadas',()=>{
 assert.equal(storeKey('Green Man Gaming'),'greenmangaming');
 assert.equal(sourceName('cs:greenmangaming'),'Green Man Gaming');
 assert.equal(sourceName('cs:fanatical'),'Fanatical');
 assert.equal(sourceName('steam'),null);
});
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDb,upsertOffer,getOffer}=require('../db');
test('SQLite persiste ofertas de diferentes lojas sem misturar moedas',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamedeals-partners-'));
  const db=openDb(dir);
  const a=normalizeDeal(deal,stores);const b=normalizeDeal({...deal,storeID:'8',dealID:'987xyzDEALxyz'},stores);
  assert.equal(upsertOffer(db,a),true);assert.equal(upsertOffer(db,b),true);
  assert.equal(getOffer(db,a.key).currency,'USD');assert.equal(getOffer(db,b.key).source,'cs:fanatical');
  const r=db.prepare('SELECT source,price_cents,currency FROM offers ORDER BY source').all();
  assert.equal(r.length,2);assert.ok(r.every(x=>x.currency==='USD' && x.price_cents===999));
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('SQLite mantém banner já conhecido quando consulta não traz imagem',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamedeals-img-'));
 const db=openDb(dir),a=normalizeDeal(deal,stores);
 upsertOffer(db,a);upsertOffer(db,{...a,image:null});
 assert.equal(getOffer(db,a.key).image,a.image);
 db.close();fs.rmSync(dir,{recursive:true,force:true});
});
const {storeBrowseParams,STORE_PAGE_SIZE}=require('../cheapshark');
test('Pagina de catalogo filtra apenas uma loja e ofertas em promocao',()=>{
  const p=storeBrowseParams('3',2);
  assert.equal(p.get('storeID'),'3');
  assert.equal(p.get('onSale'),'1');
  assert.equal(p.get('pageNumber'),'2');
  assert.equal(Number(p.get('pageSize')),STORE_PAGE_SIZE);
  assert.equal(p.get('sortBy'),'DealRating');
});
test('Rejeita parametros que poderiam consultar lojas nao validadas ou paginas excessivas',()=>{
  assert.throws(()=>storeBrowseParams('3,7',0));
  assert.throws(()=>storeBrowseParams('3',-1));
  assert.throws(()=>storeBrowseParams('3',101));
});
