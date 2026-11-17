'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  EmbedBuilder,ActionRowBuilder,StringSelectMenuBuilder,ButtonBuilder,ButtonStyle
}=require('discord.js');

const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
const start=source.indexOf('function menu(');
const end=source.indexOf('\nasync function ensureGuild(guild)',start);
assert.ok(start>=0&&end>start,'menu() deve estar isolada antes de ensureGuild');
const btn=(id,label,style,emoji)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji);
const createMenu=Function('EmbedBuilder','ActionRowBuilder','StringSelectMenuBuilder','btn','ButtonStyle',
  source.slice(start,end)+'\nreturn menu;')(EmbedBuilder,ActionRowBuilder,StringSelectMenuBuilder,btn,ButtonStyle);

test('menu compacto possui apenas uma fila de acoes diretas e uma selecao avancada',()=>{
  const menu=createMenu('1476140209556029462');
  assert.equal(menu.embeds.length,1);
  assert.equal(menu.components.length,2,'1 linha de botoes + 1 linha de seletor');
  const [actions,selector]=menu.components.map(row=>row.toJSON().components);
  assert.equal(actions.length,5);
  assert.deepEqual(actions.map(x=>x.custom_id),['gd:offers','gd:search','gd:free','gd:wishlist','gd:live']);
  assert.equal(selector.length,1);
  assert.equal(selector[0].custom_id,'gd:nav');
  const values=selector[0].options.map(x=>x.value);
  assert.deepEqual(values,['partners','bundles','history','status','settings','help']);
  assert.equal(new Set(values).size,values.length);
  assert.ok(selector[0].options.every(o=>o.description));
  const embed=menu.embeds[0].toJSON();
  assert.match(embed.title,/Central de Ofertas/);
  assert.match(embed.description,/<#1476140209556029462>/);
  assert.doesNotMatch(embed.description,/<#0>/);
});
test('canal criado e nome antigo migrado sem remover mensagens ou nomes personalizados',()=>{
  assert.match(source,/if \(!central\) central = all\.find\(c=>c\?\.name==='central-de-ofertas'/);
  assert.match(source,/all\.find\(c=>c\?\.name==='central-de-jogos'/);
  assert.match(source,/guild\.channels\.create\(\{name:'central-de-ofertas'/);
  assert.match(source,/central\.name==='central-de-jogos' && me\.permissions\.has\(PermissionFlagsBits\.ManageChannels\)/);
  assert.match(source,/central\.setName\('central-de-ofertas'/);
  assert.match(source,/message\.edit\(menu\(deals\.id\)\)/);
  assert.match(source,/dbApi\.setGuild\(db,guild\.id,central\.id,deals\.id,message\.id\)/);
});
test('o seletor de navegacao aponta somente para as seis rotas existentes',()=>{
  assert.match(source,/if\(id==='gd:nav'\)\{/);
  assert.match(source,/new Set\(\['partners','bundles','history','status','settings','help'\]\)/);
  assert.match(source,/return onButton\(i,'gd:'\+val\)/);
  assert.match(source,/async function onButton\(i,routeId=i\.customId\)/);
});
