'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const engine=require('../deal-engine'),dbApi=require('../db');
const epic={key:'epic:app:promo',source:'epic',title:'Jogo teste',kind:'app',url:'https://store.epicgames.com/pt-BR/free-games',image:null,currency:'BRL',priceCents:0,originalCents:9999,discount:100,expiresAt:'2099-01-01T00:00:00.000Z'};
const normal={key:'steam:app:42',source:'steam',title:'Jogo Especial Deluxe',kind:'app',url:'https://store.steampowered.com/app/42/',image:null,currency:'BRL',priceCents:3299,originalCents:9999,discount:67,expiresAt:null};
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamedeals-v09-'));const db=dbApi.openDb(dir);
  try{return fn(db);}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
test('Epic temporariamente grátis é elegível; free-to-play e expirada não',()=>{
  assert.equal(engine.validOffer(epic),true);
  assert.equal(engine.eligibleGuild(epic,{enabled:1,min_discount:90,max_price_cents:null}),true);
  assert.equal(engine.validOffer({...epic,originalCents:0}),false);
  assert.equal(engine.validOffer({...epic,expiresAt:'2020-01-01T00:00:00Z'}),false);
  assert.equal(engine.eligibleGuild({...epic,currency:'USD'},{enabled:1,min_discount:0,max_price_cents:10000}),false);
  assert.equal(engine.eligibleGuild(normal,{enabled:1,min_discount:70,max_price_cents:null}),false);
});
test('ordenação preserva grupos de moeda e filtros conservam preços reais',()=>{
  const offers=[{...normal,priceCents:3300,discount:50},{...normal,key:'cs:gog:3',source:'cs:gog',currency:'USD',priceCents:100,discount:90},{...normal,key:'steam:app:77',priceCents:500,discount:80}];
  const prices=engine.orderOffers(offers,'price');
  assert.deepEqual(prices.map(o=>o.currency),['BRL','BRL','USD']);
  assert.deepEqual(prices.map(o=>o.priceCents),[500,3300,100]);
  assert.deepEqual(engine.orderOffers(offers,'discount').map(o=>o.discount),[90,80,50]);
  assert.equal(engine.orderOffers(offers,'relevance','BRL',true).length,2);
});
test('identidade entre lojas normaliza acentos sem misturar edições Deluxe e padrão',()=>{
  assert.equal(engine.gameKey({...normal,title:'Jógo Especial DELUXE'}),engine.gameKey(normal));
  assert.notEqual(engine.gameKey({...normal,title:'Jogo Especial'}),engine.gameKey(normal));
  assert.notEqual(engine.gameKey({...normal,kind:'sub'}),engine.gameKey(normal));
  assert.equal(engine.gameKey({...normal,title:''}),null);
});
test('migrações preservam histórico, fonte de dados e lista multiloja',()=>{
  fixture(db=>{
    assert.equal(db.prepare('PRAGMA table_info(offers)').all().some(c=>c.name==='game_key'),true);
    assert.equal(db.prepare('PRAGMA table_info(sources)').all().some(c=>c.name==='last_success_at'),true);
    dbApi.upsertOffer(db,normal);
    assert.equal(dbApi.getOffer(db,normal.key).game_key,engine.gameKey(normal));
    dbApi.upsertGameWatch(db,{userId:'u',key:engine.gameKey(normal),title:normal.title,currency:'BRL',maxCents:3000});
    assert.equal(dbApi.watchGameList(db,'u').length,1);
    dbApi.upsertGameWatch(db,{userId:'u',key:engine.gameKey(normal),title:normal.title,currency:'BRL'});
    assert.equal(dbApi.watchGameList(db,'u')[0].max_cents,3000);
    dbApi.setSource(db,'steam',12);
    const success=db.prepare("SELECT last_success_at FROM sources WHERE source='steam'").get().last_success_at;
    dbApi.setSource(db,'steam',0,'HTTP 503');
    assert.equal(db.prepare("SELECT last_success_at FROM sources WHERE source='steam'").get().last_success_at,success);
    assert.equal(db.prepare("SELECT last_error FROM sources WHERE source='steam'").get().last_error,'HTTP 503');
    assert.ok(dbApi.getGuildStats(db).offers>0);
  });
});
test('fila persistente evita duplicações, tenta falhas e permite reenvio manual',()=>{
  fixture(db=>{
    const id=engine.queueId('guild','g1',normal.key,1234);
    const item={id,type:'guild',target:'g1',offerKey:normal.key,priceCents:3299,createdAt:1000};
    dbApi.enqueueDelivery(db,item);dbApi.enqueueDelivery(db,item);
    assert.equal(dbApi.dueDeliveries(db,20,1000).length,1);
    dbApi.deliveryResult(db,id,false,'temporário',1000,30000);
    assert.equal(dbApi.dueDeliveries(db,20,30000).length,0);
    assert.equal(dbApi.dueDeliveries(db,20,32000).length,1);
    dbApi.deliveryResult(db,id,true);
    assert.equal(dbApi.dueDeliveries(db,20,100000).length,0);
    assert.equal(dbApi.queueStats(db).find(x=>x.status==='delivered').n,1);
    const another={...item,id:engine.queueId('dm','u',normal.key,2222),type:'dm',target:'u'};
    dbApi.enqueueDelivery(db,another);
    db.prepare("UPDATE delivery_queue SET status='failed' WHERE id=?").run(another.id);
    assert.equal(dbApi.retryFailedDeliveries(db,100000),1);
    assert.equal(dbApi.dueDeliveries(db,20,100000).length,1);
  });
});
test('Epic, painel de pesquisa, metas e relatórios continuam integrados',()=>{
  const index=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
  const deploy=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');
  assert.match(index,/engine\.validOffer\(o\)/);
  assert.doesNotMatch(index,/o\.source==='epic' && o\.price_cents/);
  assert.match(index,/gd:filters:/);
  assert.match(index,/gd:gametarget:/);
  assert.match(index,/gd:report/);
  assert.match(deploy,/deal-engine\.js/);
});
