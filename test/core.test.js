'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {normalizeSteamItem,epicOffersFromResponse,formatMoney}=require('../store');
const {openDb,upsertOffer,recentDeals,freeGames}=require('../db');

test('promoção Steam guarda centavos sem arredondar',()=>{
  const o=normalizeSteamItem({id:123,type:'app',name:'Jogo Teste',original_price:9999,final_price:4999,discount_percent:50,currency:'BRL'});
  assert.equal(o.key,'steam:app:123'); assert.equal(o.priceCents,4999);assert.equal(o.currency,'BRL');
  assert.match(formatMoney(o.priceCents,o.currency),/49,99/);
});
test('Epic ignora free-to-play e futuras promoções',()=>{
  const now=Date.parse('2026-11-10T12:00:00Z');
  const promo=(start,end)=>({promotionalOffers:[{startDate:start,endDate:end,discountSetting:{discountPercentage:0}}]});
  const g=(id,original,promos)=>({id,title:id,offerType:'BASE_GAME',price:{totalPrice:{originalPrice:original,currencyCode:'BRL'}},promotions:{promotionalOffers:promos},offerMappings:[{pageSlug:id}]});
  const data={data:{Catalog:{searchStore:{elements:[
    g('valido',8999,[promo('2026-11-09T00:00:00Z','2026-11-12T00:00:00Z')]),
    g('f2p',0,[promo('2026-11-09T00:00:00Z','2026-11-12T00:00:00Z')]),
    g('futuro',8999,[promo('2026-11-11T00:00:00Z','2026-11-19T00:00:00Z')])
  ]}}}};
  const found=epicOffersFromResponse(data,now);
  assert.equal(found.length,1);assert.equal(found[0].key,'epic:app:valido');assert.equal(found[0].priceCents,0);
});
test('SQLite não duplica históricos para preço inalterado',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'game-deals-'));
  const db=openDb(dir);
  const offer={key:'steam:app:33',source:'steam',kind:'app',title:'Teste',url:'https://store.steampowered.com/app/33/',image:null,currency:'BRL',priceCents:1000,originalCents:2000,discount:50,expiresAt:null};
  assert.equal(upsertOffer(db,offer),true);assert.equal(upsertOffer(db,offer),false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM price_history').get().n,1);
  assert.equal(recentDeals(db).length,1);
  assert.equal(freeGames(db).length,0);
  assert.equal(upsertOffer(db,{...offer,priceCents:900}),true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM price_history').get().n,2);
  db.close(); fs.rmSync(dir,{recursive:true,force:true});
});
