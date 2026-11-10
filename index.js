'use strict';

const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const dbApi = require('./db');
const stores = require('./store');

if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'cole_no_painel_da_square_cloud_nao_aqui') {
  console.error('DISCORD_TOKEN ausente. Configure uma variável de ambiente na Square Cloud (não envie o token para GitHub).');
  process.exit(1);
}
const db = dbApi.openDb();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const POLL_MS = Math.max(15, Number(process.env.POLL_MINUTES) || 30) * 60 * 1000;
const DEFAULT_DISCOUNT = Math.max(0, Math.min(100, Number(process.env.MIN_DISCOUNT) || 50));
let pollActive = false;
const initializedSources = new Set(db.prepare("SELECT key FROM meta WHERE key LIKE 'source_init:%'").all().map(row => row.key.slice('source_init:'.length)));

function log(...args) { console.log(new Date().toISOString(), ...args); }
function btn(id, label, style=ButtonStyle.Secondary, emoji) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji || '🎮'); }
function rows(...buttons) { return buttons.map((b,i)=>({b,i})).reduce((acc,{b,i})=>{ if (i%5===0) acc.push(new ActionRowBuilder()); acc[acc.length-1].addComponents(b); return acc; },[]); }
function menu() {
  const embed = new EmbedBuilder().setColor(0x274667).setTitle('🎮 GameDeals • Central de jogos')
    .setDescription('**Bem-vindo à sua central de promoções!**\n\nPesquise jogos, consulte descontos, acompanhe preços e veja os jogos grátis. Clique em uma opção abaixo. Sua navegação é privada: outras pessoas não verão suas pesquisas.\n\n🔄 Dados obtidos de fontes externas e atualizados periodicamente. Preços e disponibilidade devem ser confirmados na loja antes da compra.')
    .addFields({name:'📢 Notificações automáticas',value:'São enviadas no canal **#promocoes-de-jogos**.',inline:false})
    .setFooter({text:'GameDeals • Menu principal • Navegação por botões'});
  return { embeds:[embed], components:[
    ...rows(btn('gd:offers','Ofertas',ButtonStyle.Primary,'🏷️'),btn('gd:search','Pesquisar',ButtonStyle.Primary,'🔎'),btn('gd:free','Jogos grátis',ButtonStyle.Success,'🎁'),btn('gd:wishlist','Meus desejos',ButtonStyle.Secondary,'❤️'),btn('gd:history','Histórico',ButtonStyle.Secondary,'📈')),
    ...rows(btn('gd:bundles','Pacotes',ButtonStyle.Secondary,'📦'),btn('gd:status','Status',ButtonStyle.Secondary,'📡'),btn('gd:settings','Administração',ButtonStyle.Secondary,'⚙️'),btn('gd:help','Ajuda',ButtonStyle.Secondary,'❓'))
  ]};
}

async function ensureGuild(guild) {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ViewChannel) || !me.permissions.has(PermissionFlagsBits.SendMessages)) { log('Permissões insuficientes no servidor',guild.name); return; }
  const saved = dbApi.getGuild(db,guild.id);
  const all = await guild.channels.fetch();
  let central = saved?.menu_channel && all.get(saved.menu_channel);
  let deals = saved?.deals_channel && all.get(saved.deals_channel);
  if (!central) central = all.find(c=>c?.name==='central-de-jogos' && c.type===ChannelType.GuildText);
  if (!deals) deals = all.find(c=>c?.name==='promocoes-de-jogos' && c.type===ChannelType.GuildText);
  if ((!central || !deals) && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    log(`Preciso da permissão Gerenciar Canais no servidor ${guild.name}, ou dos canais central-de-jogos e promocoes-de-jogos criados manualmente.`); return;
  }
  if (!central) central = await guild.channels.create({name:'central-de-jogos',type:ChannelType.GuildText,topic:'Painel interativo permanente do GameDeals. Use os botões.'});
  if (!deals) deals = await guild.channels.create({name:'promocoes-de-jogos',type:ChannelType.GuildText,topic:'Notificações automáticas de descontos e jogos grátis.'});
  if (!central.isTextBased() || !deals.isTextBased()) return;
  let message = null;
  if (saved?.menu_message) { try { message = await central.messages.fetch(saved.menu_message); } catch {} }
  if (!message) {
    try {
      const recent = await central.messages.fetch({limit:50});
      message = recent.find(m=>m.author.id===client.user.id && m.embeds.some(e=>e.footer?.text?.includes('GameDeals • Menu principal')));
    } catch {}
  }
  if (message) await message.edit(menu()); else message = await central.send(menu());
  if (me.permissions.has(PermissionFlagsBits.ManageMessages)) {
    try { if (!message.pinned) await message.pin(); } catch {}
  }
  dbApi.setGuild(db,guild.id,central.id,deals.id,message.id);
  if (!saved) db.prepare('UPDATE guilds SET min_discount=? WHERE guild_id=?').run(DEFAULT_DISCOUNT,guild.id);
  log(`Menu ativo em ${guild.name}: #${central.name}; notificações: #${deals.name}`);
}

function short(s,n=80){return String(s||'').length>n?String(s).slice(0,n-1)+'…':String(s||'');}
function summary(o) {
  return `**${short(o.title,65)}** — ${stores.formatMoney(o.price_cents,o.currency)}${o.discount?` (**-${o.discount}%**)`:''} • ${o.source==='steam'?'Steam':'Epic'}\n${o.url}`;
}
function offerEmbed(o) {
  const e = new EmbedBuilder().setTitle(short(o.title,240)).setURL(o.url).setColor(o.price_cents===0?0x2ecc71:0x2678c9)
    .setDescription(`**${stores.formatMoney(o.price_cents,o.currency)}**  ${o.discount?`• **-${o.discount}%**`:''}\nPreço original: ${stores.formatMoney(o.original_cents,o.currency)}\nLoja: ${o.source==='steam'?'Steam':'Epic Games'}\n[Ver oferta na loja](${o.url})`)
    .setFooter({text:'GameDeals • Confirme o preço e a região na loja antes de comprar'});
  if (o.image && /^https:\/\//.test(o.image)) e.setThumbnail(o.image);
  if (o.expires_at) e.addFields({name:'Término informado',value:`<t:${Math.floor(Date.parse(o.expires_at)/1000)}:R>`,inline:true});
  return e;
}
const intro = (title, description) => new EmbedBuilder().setColor(0x274667).setTitle(title).setDescription(description).setFooter({text:'GameDeals • Dados indicativos; confirme na loja'});

function listView(kind, page=0) {
  const list = kind==='free'?dbApi.freeGames(db,75):kind==='bundles'?dbApi.recentDeals(db,0,75).filter(o=>o.kind==='sub'):dbApi.recentDeals(db,0,75);
  const actualPage = Math.max(0,Math.min(page,Math.max(0,Math.ceil(list.length/5)-1)));
  const slice=list.slice(actualPage*5,actualPage*5+5);
  const titles = {free:'🎁 Jogos grátis temporários',offers:'🏷️ Promoções na Steam',bundles:'📦 Pacotes em promoção'};
  const embed=intro(titles[kind],slice.length?slice.map(summary).join('\n\n'):'Nenhuma oferta recente encontrada nessa categoria. A coleta pode ainda não ter sido executada ou a fonte pode estar indisponível.');
  embed.addFields({name:'Página',value:`${actualPage+1}/${Math.max(1,Math.ceil(list.length/5))}`,inline:true});
  const buttons=[];
  if(actualPage>0) buttons.push(btn(`gd:page:${kind}:${actualPage-1}`,'Anterior',ButtonStyle.Secondary,'⬅️'));
  if((actualPage+1)*5<list.length) buttons.push(btn(`gd:page:${kind}:${actualPage+1}`,'Próxima',ButtonStyle.Secondary,'➡️'));
  const result={embeds:[embed],components:buttons.length?rows(...buttons):[]};
  if (slice.length) result.components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:offer').setPlaceholder('Abrir uma oferta').addOptions(slice.map(o=>({label:short(o.title,95),description:`${stores.formatMoney(o.price_cents,o.currency)} • ${o.source}`,value:o.offer_key})))));
  return result;
}

function offerView(o, userId) {
  const isWatched=Boolean(db.prepare('SELECT 1 FROM watchlist WHERE user_id=? AND offer_key=?').get(userId,o.offer_key));
  return {embeds:[offerEmbed(o)],components:[...rows(
    btn(`gd:watch:${o.offer_key}`,isWatched?'Parar de seguir':'Acompanhar',isWatched?ButtonStyle.Danger:ButtonStyle.Success,isWatched?'🗑️':'❤️'),
    btn(`gd:target:${o.offer_key}`,'Definir alerta',ButtonStyle.Secondary,'🔔'),
    btn(`gd:history:${o.offer_key}`,'Histórico',ButtonStyle.Secondary,'📈'))]};
}
function historyView(key) {
  const o = dbApi.getOffer(db,key);
  if (!o) return {embeds:[intro('Histórico','Oferta não encontrada.')],components:[]};
  const arr=db.prepare('SELECT price_cents,currency,recorded_at FROM price_history WHERE offer_key=? ORDER BY recorded_at DESC LIMIT 12').all(key);
  const prices=arr.map(x=>x.price_cents); const low=prices.length?Math.min(...prices):null;
  return {embeds:[intro('📈 Histórico • '+short(o.title,150), `${arr.map(x=>`<t:${Math.floor(x.recorded_at/1000)}:d> — **${stores.formatMoney(x.price_cents,x.currency)}**`).join('\n') || 'Sem dados ainda.'}\n\n${low===null?'':`Menor preço **registrado pelo bot**: ${stores.formatMoney(low,o.currency)}.`}\n\n*Não representa o menor preço histórico de toda a loja; o registro começou quando o bot passou a acompanhar o produto.*`)]};
}
function modal(id,title,label,placeholder) { return new ModalBuilder().setCustomId(id).setTitle(short(title,42)).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))); }

async function interactionReply(interaction, data) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({flags:MessageFlags.Ephemeral});
  return interaction.editReply(data);
}
function canAdmin(i){return Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));}

async function onButton(i) {
  const id=i.customId;
  if(id==='gd:search') return i.showModal(modal('gd:search:submit','Pesquisar jogos na Steam','Nome do jogo','Ex.: Red Dead Redemption 2'));
  if (id.startsWith('gd:target:')) {
    const key=id.slice('gd:target:'.length);
    if(!dbApi.getOffer(db,key)) return interactionReply(i,{content:'Oferta não encontrada.'});
    return i.showModal(modal(`gd:targetsave:${key}`,'Alerta personalizado','Preço máximo em reais (ex.: 49,90)','49,90'));
  }
  if (id==='gd:settings') {
    if(!canAdmin(i)) return interactionReply(i,{content:'Somente membros com Gerenciar Servidor podem alterar estas configurações.'});
    const g=dbApi.getGuild(db,i.guildId);
    return interactionReply(i,{embeds:[intro('⚙️ Administração',`Notificações: **${g?.enabled?'Ligadas':'Desligadas'}**\nDesconto mínimo: **${g?.min_discount||0}%**\n\nEscolha uma opção abaixo.`)],components:rows(btn('gd:toggle','Ligar/desligar avisos',ButtonStyle.Primary,'🔔'),btn('gd:discount','Alterar desconto mínimo',ButtonStyle.Secondary,'🏷️'),btn('gd:sample','Publicar 3 ofertas',ButtonStyle.Secondary,'📢'))});
  }
  if(id==='gd:toggle' && canAdmin(i)) {
    const g=dbApi.getGuild(db,i.guildId); db.prepare('UPDATE guilds SET enabled=? WHERE guild_id=?').run(g?.enabled?0:1,i.guildId);
    return interactionReply(i,{content:`Notificações ${g?.enabled?'desativadas':'ativadas'} neste servidor.`});
  }
  if(id==='gd:discount' && canAdmin(i)) return interactionReply(i,{content:'Selecione o desconto mínimo para anúncios automáticos:',components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:discount:select').addOptions([0,20,30,50,70,90].map(n=>({label:`${n}%`,value:String(n)}))))]});
  if(id==='gd:sample' && canAdmin(i)) {
    await interactionReply(i,{content:'Publicando até 3 ofertas recentes no canal de notificações...'});
    const g=dbApi.getGuild(db,i.guildId); const c=await client.channels.fetch(g.deals_channel);
    const sample=dbApi.recentDeals(db,g.min_discount,3);
    if(!sample.length) return i.editReply('Ainda não existem promoções recentes armazenadas.');
    let n=0;for(const o of sample){try{await c.send({embeds:[offerEmbed(o)]});n++;}catch(err){log('Falha no exemplo',err.message);}}
    return i.editReply(`Publiquei ${n} oferta(s) no canal <#${g.deals_channel}>.`);
  }
  if(id.startsWith('gd:page:')) {const [, ,kind,page]=id.split(':'); return interactionReply(i,listView(kind,Number(page)||0));}
  if(id==='gd:offers' || id==='gd:free' || id==='gd:bundles') return interactionReply(i,listView(id.slice(3)));
  if(id==='gd:help') return interactionReply(i,{embeds:[intro('❓ Como usar','**Pesquisar:** encontre um jogo na Steam e abra os detalhes.\n**Acompanhar:** salva o produto na sua lista pessoal.\n**Definir alerta:** você recebe DM se o bot identificar um preço igual ou abaixo do limite (quando DMs são permitidas).\n**Jogos grátis:** resgates temporários encontrados na Epic Games.\n**Histórico:** preços que nosso bot registrou desde que começou a acompanhar.\n\nNão enviamos notificações de ofertas fictícias nem prometemos cobertura de todas as lojas.')]});
  if(id==='gd:status') {
    const states=db.prepare('SELECT * FROM sources').all();
    const status=states.length?states.map(s=>`${s.source==='steam'?'Steam':'Epic'}: ${s.last_error?'⚠️ '+short(s.last_error,90):'✅ OK'} • ${s.item_count} itens • <t:${Math.floor(s.checked_at/1000)}:R>`).join('\n'):'Coleta ainda não iniciada.';
    return interactionReply(i,{embeds:[intro('📡 Estado do monitor',`${status}\n\nVerificações a cada **${POLL_MS/60000} minutos**. Os horários refletem a coleta, não necessariamente a atualização da loja.`)]});
  }
  if(id==='gd:wishlist') {
    const list=dbApi.watchList(db,i.user.id);
    const e=intro('❤️ Meus jogos acompanhados',list.length?list.map(o=>`**${short(o.title,60)}** — ${stores.formatMoney(o.price_cents,o.currency)}${o.target_cents===null?'':` • Alerta: ${stores.formatMoney(o.target_cents,o.currency)}`}`).join('\n'):'Sua lista está vazia. Clique em **Pesquisar** e depois em **Acompanhar**.');
    const components=[];
    if(list.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:unwatch:select').setPlaceholder('Remover jogo da lista').addOptions(list.slice(0,25).map(o=>({label:short(o.title,90),value:o.offer_key})))));
    return interactionReply(i,{embeds:[e],components});
  }
  if(id==='gd:history') {
    const list=db.prepare('SELECT offer_key,title FROM offers ORDER BY changed_at DESC LIMIT 25').all();
    return interactionReply(i,{embeds:[intro('📈 Histórico de preços','Escolha um jogo para consultar o histórico registrado pelo nosso bot.')],components:list.length?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:history:select').setPlaceholder('Selecione um jogo').addOptions(list.map(o=>({label:short(o.title,90),value:o.offer_key}))))]:[]});
  }
  if(id.startsWith('gd:history:')) return interactionReply(i,historyView(id.slice('gd:history:'.length)));
  if(id.startsWith('gd:watch:')) {
    const key=id.slice('gd:watch:'.length),offer=dbApi.getOffer(db,key);if(!offer)return interactionReply(i,{content:'Oferta não encontrada.'});
    const found=db.prepare('SELECT 1 FROM watchlist WHERE user_id=? AND offer_key=?').get(i.user.id,key);
    if(found)db.prepare('DELETE FROM watchlist WHERE user_id=? AND offer_key=?').run(i.user.id,key);
    else db.prepare('INSERT INTO watchlist(user_id,offer_key,target_cents,created_at) VALUES(?,?,NULL,?)').run(i.user.id,key,Date.now());
    return interactionReply(i,{content:found?'Jogo removido da sua lista.':'Jogo adicionado à sua lista. Você pode definir um preço-alvo na opção **Definir alerta**.',...offerView(offer,i.user.id)});
  }
  if (id.startsWith('gd:')) return interactionReply(i,{content:'Opção indisponível ou reservada para administradores.'});
}

async function onSelect(i) {
  const id=i.customId,val=i.values[0];
  if(id==='gd:offer' || id==='gd:history:select') {
    const offer=dbApi.getOffer(db,val);
    return interactionReply(i,id==='gd:offer'?(offer?offerView(offer,i.user.id):{content:'Oferta não encontrada.'}):historyView(val));
  }
  if(id==='gd:lookup') {
    const [type,rawId]=val.split(':');const idNum=Number(rawId);
    if(!['app','sub'].includes(type)||!Number.isSafeInteger(idNum))return interactionReply(i,{content:'Produto inválido.'});
    const key=`steam:${type}:${idNum}`;
    let o=dbApi.getOffer(db,key);
    if(!o) return interactionReply(i,{content:'Este produto não está mais no cache. Faça uma nova pesquisa.'});
    await i.deferReply({flags:MessageFlags.Ephemeral});
    try {const fresh=await stores.steamAppDetails(type,idNum);if(fresh){dbApi.upsertOffer(db,{key:o.offer_key,title:o.title,source:o.source,kind:o.kind,url:o.url,image:o.image,currency:fresh.currency,originalCents:fresh.originalCents,priceCents:fresh.priceCents,discount:fresh.discount,expiresAt:null});o=dbApi.getOffer(db,key);}}catch(err){log('Detalhes Steam indisponíveis:',err.message);}
    return interactionReply(i,offerView(o,i.user.id));
  }
  if(id==='gd:discount:select') {
    if(!canAdmin(i))return interactionReply(i,{content:'Sem permissão.'});
    db.prepare('UPDATE guilds SET min_discount=? WHERE guild_id=?').run(Number(val),i.guildId);
    return interactionReply(i,{content:`Desconto mínimo alterado para **${val}%**.`});
  }
  if(id==='gd:unwatch:select') {db.prepare('DELETE FROM watchlist WHERE user_id=? AND offer_key=?').run(i.user.id,val);return interactionReply(i,{content:'Jogo removido da sua lista de desejos.'});}
}

async function onModal(i) {
  const id=i.customId;const value=i.fields.getTextInputValue('value')?.trim();
  if(id==='gd:search:submit') {
    await i.deferReply({flags:MessageFlags.Ephemeral});
    let results=[];try{results=await stores.searchSteam(value);}catch(err){return i.editReply(`Não consegui consultar a Steam agora (${short(err.message,120)}). Tente novamente mais tarde.`);}
    if(!results.length)return i.editReply('Nenhum jogo encontrado na Steam para esse nome.');
    for (const o of results) dbApi.upsertOffer(db,o);
    return i.editReply({embeds:[intro('🔎 Resultados para '+short(value,150),results.slice(0,10).map(o=>`**${short(o.title,70)}** — ${stores.formatMoney(o.priceCents,o.currency)}${o.discount?` • -${o.discount}%`:''}`).join('\n'))],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:lookup').setPlaceholder('Escolha o produto').addOptions(results.map(o=>({label:short(o.title,95),value:`${o.kind}:${o.key.split(':')[2]}`}))))]});
  }
  if(id.startsWith('gd:targetsave:')) {
    const key=id.slice('gd:targetsave:'.length);const offer=dbApi.getOffer(db,key);
    if(!offer)return interactionReply(i,{content:'Oferta não encontrada.'});
    if(offer.currency!=='BRL')return interactionReply(i,{content:'Alertas por valor em reais estão disponíveis apenas para preços em BRL.'});
    const normalized=value.replace(/\s/g,'').replace(/^R\$/i,'').replace(/\./g,'').replace(',','.');
    const parsed=Number(normalized);
    if(!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(normalized)||!Number.isFinite(parsed)||parsed<0||parsed>100000)return interactionReply(i,{content:'Valor inválido. Exemplo: 49,90'});
    const cents=Math.round(parsed*100);
    db.prepare('INSERT INTO watchlist(user_id,offer_key,target_cents,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,offer_key) DO UPDATE SET target_cents=excluded.target_cents').run(i.user.id,key,cents,Date.now());
    return interactionReply(i,{content:`🔔 Alerta para **${offer.title}** configurado em ${stores.formatMoney(cents,'BRL')}. O bot tentará mandar uma DM quando detectar uma nova oferta nesse valor ou abaixo dele.`});
  }
}

client.on('interactionCreate',async i=>{
  if(!i.isButton() && !i.isStringSelectMenu() && !i.isModalSubmit())return;
  if(!i.customId.startsWith('gd:'))return;
  if(!i.guildId)return i.reply({content:'Abra o painel dentro de um servidor.',flags:MessageFlags.Ephemeral});
  try {if(i.isButton())await onButton(i);else if(i.isStringSelectMenu())await onSelect(i);else await onModal(i);}
  catch(e){log('Falha na interação',i.customId,e.stack||e.message);try{if(i.deferred||i.replied)await i.editReply({content:'Ocorreu um erro temporário. Tente novamente.'});else await i.reply({content:'Ocorreu um erro temporário. Tente novamente.',flags:MessageFlags.Ephemeral});}catch{}}
});

async function announce(o) {
  const guilds=db.prepare('SELECT * FROM guilds WHERE enabled=1 AND deals_channel IS NOT NULL').all();
  for(const g of guilds) {
    if(o.source==='steam' && o.discount<g.min_discount)continue;
    if(o.source==='epic' && o.price_cents!==0)continue;
    if(db.prepare('SELECT 1 FROM notifications WHERE guild_id=? AND offer_key=? AND price_cents=?').get(g.guild_id,o.key,o.priceCents))continue;
    try {
      const channel=await client.channels.fetch(g.deals_channel);
      if(!channel?.isTextBased())continue;
      await channel.send({embeds:[offerEmbed({offer_key:o.key,title:o.title,url:o.url,price_cents:o.priceCents,original_cents:o.originalCents,currency:o.currency,discount:o.discount,source:o.source,image:o.image,expires_at:o.expiresAt})]});
      db.prepare('INSERT OR IGNORE INTO notifications(guild_id,offer_key,price_cents,delivered_at) VALUES(?,?,?,?)').run(g.guild_id,o.key,o.priceCents,Date.now());
      await new Promise(r=>setTimeout(r,1000));
    } catch(e){log('Falha ao notificar servidor',g.guild_id,e.message);}
  }
}

async function notifyWatchers(o) {
  if(o.currency!=='BRL')return;
  const users=db.prepare('SELECT user_id FROM watchlist WHERE offer_key=? AND target_cents IS NOT NULL AND target_cents>=?').all(o.key,o.priceCents);
  for(const {user_id} of users){
    if(db.prepare('SELECT 1 FROM dm_notifications WHERE user_id=? AND offer_key=? AND price_cents=?').get(user_id,o.key,o.priceCents))continue;
    try {
      const u=await client.users.fetch(user_id);
      await u.send({content:`🔔 Seu alerta de preço foi atingido!`,embeds:[offerEmbed({offer_key:o.key,title:o.title,url:o.url,price_cents:o.priceCents,original_cents:o.originalCents,currency:o.currency,discount:o.discount,source:o.source,image:o.image,expires_at:o.expiresAt})]});
      db.prepare('INSERT OR IGNORE INTO dm_notifications(user_id,offer_key,price_cents,delivered_at) VALUES(?,?,?,?)').run(user_id,o.key,o.priceCents,Date.now());
    } catch(e){log('Não foi possível enviar DM',user_id,e.message);}
  }
}

async function poll(){
  if(pollActive)return;pollActive=true;
  const sources=[['steam',stores.steamSpecials],['epic',stores.epicFreeGames]];
  for(const [source,reader] of sources) {
    try {
      const offers=await reader();
      let updated=0;
      for(const o of offers){
        const changed=dbApi.upsertOffer(db,o);
        if(changed){updated++;if(initializedSources.has(source)){await announce(o);await notifyWatchers(o);}}
      }
      dbApi.setSource(db,source,offers.length);
      if(!initializedSources.has(source)){
        db.prepare("INSERT INTO meta(key,value) VALUES(?, 'yes') ON CONFLICT(key) DO UPDATE SET value='yes'").run(`source_init:${source}`);
        initializedSources.add(source);
        log(`Fonte ${source} inicializada sem disparar anúncios antigos.`);
      }
      log(`Fonte ${source}: ${offers.length} produtos, ${updated} preços novos/alterados`);
    } catch(e){dbApi.setSource(db,source,0,e.message);log(`Falha na fonte ${source}:`,e.message);}
    await new Promise(r=>setTimeout(r,500));
  }
  pollActive=false;
}

client.once('ready',async()=>{
  log(`Online como ${client.user.tag} (${client.guilds.cache.size} servidores)`);
  for(const guild of client.guilds.cache.values()){try{await ensureGuild(guild);}catch(e){log('Falha ao instalar painel',guild.name,e.message);}}
  await poll();setInterval(()=>poll().catch(e=>{pollActive=false;log('Falha na varredura',e.message);}),POLL_MS);
});
client.on('guildCreate',guild=>ensureGuild(guild).catch(e=>log('Falha ao instalar novo servidor',e.message)));
client.on('error',e=>log('Erro Discord',e.message));
process.on('unhandledRejection',e=>log('Promise rejeitada',e));
process.on('SIGTERM',()=>{db.close();client.destroy();process.exit(0);});
client.login(process.env.DISCORD_TOKEN).catch(e=>{console.error('Falha no login do bot:',e.message);process.exit(1);});