'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ensureEntryPoint}=require('../live/entry-point');
const APP_ID='1569671744803967127';
const endpoint='/applications/'+APP_ID+'/commands';
test('registra comando de entrada global sem apagar /buscar',async()=>{
  let post;
  const rest={get:async path=>{assert.equal(path,endpoint);return [{name:'buscar',type:1,id:'123'}];},
    post:async(path,args)=>{assert.equal(path,endpoint);post=args.body;return {...args.body,id:'456'};},
    patch:async()=>{throw Error('não deveria atualizar')}};
  const result=await ensureEntryPoint(rest,APP_ID);
  assert.equal(result.action,'registrado');
  assert.equal(post.type,4);assert.equal(post.handler,2);
  assert.deepEqual(post.integration_types,[0]);assert.deepEqual(post.contexts,[0]);
});
test('não cria comando duplicado quando já existe entry point correto',async()=>{
  const rest={get:async()=>[{type:4,handler:2,id:'1',name:'Launch'}],post:async()=>{throw Error('duplicado')},patch:async()=>{throw Error('duplicado')}};
  const result=await ensureEntryPoint(rest,APP_ID);
  assert.equal(result.action,'existente');
});
test('corrige handler do comando pré-existente sem excluir outros comandos',async()=>{
  let updated;
  const rest={get:async()=>[{type:4,handler:1,id:'789',name:'Launch',description:'Open the Activity'},{type:1,name:'buscar'}],
    post:async()=>{throw Error('duplicado')},
    patch:async(path,{body})=>{assert.equal(path,endpoint+'/789');updated=body;return {...body,id:'789'};}};
  const result=await ensureEntryPoint(rest,APP_ID);
  assert.equal(result.action,'atualizado');assert.equal(updated.name,'Launch');assert.equal(updated.handler,2);
});
test('falha de API ou aplicação inválida produz erro claro',async()=>{
  await assert.rejects(()=>ensureEntryPoint({get:async()=>[],post:async()=>{},patch:async()=>{}},'invalid'),/Application ID/);
  await assert.rejects(()=>ensureEntryPoint({get:async()=>({}),post:async()=>{},patch:async()=>{}},APP_ID),/Resposta inválida/);
});
