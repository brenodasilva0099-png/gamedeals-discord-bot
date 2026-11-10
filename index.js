'use strict';

const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder
} = require('discord.js');
const dbApi = require('./db');
const stores = require('./store');
const shark = require('./cheapshark');
const {coverFor} = require('./media');

if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'cole_no_painel_da_square_cloud_nao_aqui') {
  console.error('DISCORD_TOKEN ausente. Configure uma variável de ambiente na Square Cloud (não envie o token para GitHub).');
  process.exit(1);
}
const db = dbApi.openDb();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const POLL_MS = Math.max(15, Number(process.env.POLL_MINUTES) || 30) * 60 * 1000;
const DEFAULT_DISCOUNT = Math.max(0, Math.min(100, Number(process.env.MIN_DISCOUNT) || 50));
const WISHLIST_CHECK_LIMIT = Math.max(1, Math.min(30, Number(process.env.WISHLIST_CHECK_LIMIT) || 12));
const OFFER_PAGE_SIZE = 2; // Dois jogos grandes por pagina: o Discord nao amplia thumbnails automaticamente.
const SEARCH_PREVIEW_SIZE = 2;
let pollActive = false;
let lastManualPoll = 0;
// Autocomplete choices are only available for slash commands (Discord API limitation).
const suggestionCache = new Map();
const SUGGESTIONS_TTL_MS = 45_000;
const searchCommand = new SlashCommandBuilder()
  .setName('buscar')
  .setDescription('Encontre jogos e veja os preços da Steam em reais')
  .addStringOption(option => option.setName('jogo').setDescription('Comece a digitar o nome do jogo')
    .setRequired(true).setAutocomplete(true));

const initializedSources = new Set(db.prepare("SELECT key FROM meta WHERE key LIKE 'source_init:%'").all().map(row => row.key.slice('source_init:'.length)));

function log(...args) { console.log(new Date().toISOString(), ...args); }
function btn(id, label, style=ButtonStyle.Secondary, emoji) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji || '🎮'); }
function rows(...buttons) { return buttons.map((b,i)=>({b,i})).reduce((acc,{b,i})=>{ if (i%5===0) acc.push(new ActionRowBuilder()); acc[acc.length-1].addComponents(b); return acc; },[]); }
function menu() {
  const embed = new EmbedBuilder().setColor(0x274667).setTitle('🎮 GameDeals • Central de jogos')
    .setDescription('**Bem-vindo à sua central de promoções!**\n\nPesquise jogos, consulte descontos, acompanhe preços e veja os jogos grátis. Clique em uma opção abaixo. Sua navegação é privada: outras pessoas não verão suas pesquisas.\n\n🔄 Dados obtidos de fontes externas e atualizados periodicamente. Preços e disponibilidade devem ser confirmados na loja antes da compra.')
    .addFields({name:'📢 Notificações automáticas',value:'São enviadas no canal **#promocoes-de-jogos**.',inline:false})
    .setFooter({text:'GameDeals • Menu principal • v0.4.0 • Navegação por botões'});
  return { embeds:[embed], components:[
    ...rows(btn('gd:offers','Ofertas',ButtonStyle.Primary,'🏷️'),btn('gd:search','Pesquisar',ButtonStyle.Primary,'🔎'),btn('gd:free','Jogos grátis',ButtonStyle.Success,'🎁'),btn('gd:wishlist','Meus desejos',ButtonStyle.Secondary,'❤️'),btn('gd:history','Histórico',ButtonStyle.Secondary,'📈')),
    ...rows(btn('gd:partners','Outras lojas',ButtonStyle.Primary,'🏬'),btn('gd:bundles','Pacotes',ButtonStyle.Secondary,'📦'),btn('gd:status','Status',ButtonStyle.Secondary,'📡'),btn('gd:settings','Administração',ButtonStyle.Secondary,'⚙️'),btn('gd:help','Ajuda',ButtonStyle.Secondary,'❓'))
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
function shopName(source) { return source==='steam'?'Steam':source==='epic'?'Epic Games':(shark.sourceName(source) || String(source)); }
function offerEmbed(o) {
  const price=stores.formatMoney(o.price_cents,o.currency);
  const e = new EmbedBuilder().setTitle(short(o.title,240)).setURL(o.url).setColor(o.price_cents===0?0x34bf80:0x2388fa)
    .setDescription(`${o.price_cents===0?'🎁 **GRÁTIS POR TEMPO LIMITADO**':`💰 **${price}**`}${o.discount?`  •  **-${o.discount}%**`:''}\n[🛒 Abrir oferta](${o.url})${o.source.startsWith('cs:')?'\n*Preço em USD informado pelo CheapShark. Link via CheapShark; verifique região e valor no checkout.*':''}`)
    .addFields(
      {name:'🏬 Loja',value:shopName(o.source),inline:true},
      {name:'💳 Preço original',value:stores.formatMoney(o.original_cents,o.currency),inline:true},
      {name:'📦 Produto',value:o.kind==='sub'?'Pacote / Bundle':'Jogo ou edição',inline:true}
    ).setFooter({text:'GameDeals • Preços informativos; confirme no checkout'});
  const image=coverFor(o); if(image)e.setImage(image);
  if(o.expires_at && Number.isFinite(Date.parse(o.expires_at))) e.addFields({name:'⏳ Oferta até',value:`<t:${Math.floor(Date.parse(o.expires_at)/1000)}:R>`,inline:true});
  if(o.seen_at) e.addFields({name:'🔄 Última consulta registrada',value:`<t:${Math.floor(o.seen_at/1000)}:R>`,inline:true});
  return e;
}
const intro=(title,description) => new EmbedBuilder().setColor(0x274667).setTitle(title).setDescription(description).setFooter({text:'GameDeals • Preços informativos; confirme na loja'});
function productCard(o, index) {
  // Banner grande no embed: thumbnails do Discord nao aumentam ao reduzir a pagina.
  const e=new EmbedBuilder().setColor(o.price_cents===0?0x21b67b:0x1f6bbc)
    .setTitle(`${index}. ${short(o.title,230)}`)
    .setURL(o.url)
    .setDescription(`**${stores.formatMoney(o.price_cents,o.currency)}**${o.discount?`  •  **-${o.discount}%**`:''}\n${shopName(o.source)}${o.kind==='sub'?' • Pacote':''}${o.source.startsWith('cs:')?' • via CheapShark (USD)':''}`);
  const image=coverFor(o); if(image)e.setImage(image);
  return e;
}
function shopLink(o) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(o.url).setLabel(`Abrir na ${shopName(o.source)}`).setEmoji('🛒'));
}
function searchResultsView(query, results) {
  if (!results.length) return {embeds:[intro('🔎 Nenhum jogo encontrado',`Não encontramos títulos para **${short(query,80)}**. Tente outro nome.`)],components:rows(btn('gd:search','Pesquisar novamente',ButtonStyle.Primary,'🔎'))};
  const list=results.slice(0,25);
  const embeds=[intro('🔎 Resultados para '+short(query,150),`**${list.length} oferta(s)** encontradas em lojas consultadas • ${Math.min(list.length,SEARCH_PREVIEW_SIZE)} banners em destaque.\nPreços em **R$** (Steam) ou **US$** (outras lojas), sem conversão fictícia. Escolha um resultado no seletor.`),...list.slice(0,SEARCH_PREVIEW_SIZE).map((o,i)=>productCard({offer_key:o.key,...o,price_cents:o.priceCents},i+1))];
  return {embeds,components:[
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:lookup').setPlaceholder('🎮 Escolha um jogo ou edição').addOptions(list.map(o=>({label:short(o.title,95),description:short(`${stores.formatMoney(o.priceCents,o.currency)}${o.discount?` • -${o.discount}%`:''} • ${shopName(o.source)}`,100),value:o.key})))),
    ...rows(btn('gd:search','Pesquisar outro jogo',ButtonStyle.Secondary,'🔎'))]};
}
async function findAllGames(query) {
  const results=await Promise.allSettled([findGames(query),shark.searchByTitle(query)]);
  const steam=results[0].status==='fulfilled'?results[0].value:[];
  const partner=results[1].status==='fulfilled'?results[1].value:[];
  if(results.every(r=>r.status==='rejected'))throw Error('Fontes de pesquisa indisponíveis');
  for(const o of partner)dbApi.upsertOffer(db,o);
  // Alterna fontes para que a segunda capa não seja sempre da mesma loja.
  const output=[];const a=steam.slice(0,10),b=partner.slice(0,15);
  while(a.length||b.length) {if(a.length)output.push(a.shift());if(b.length)output.push(b.shift());}
  return output.slice(0,25);
}
async function findGames(query, timeout = 15_000) {
  const results=await stores.searchSteam(query, timeout);
  for(const result of results)dbApi.upsertOffer(db,result);
  return results;
}
async function autocomplete(i) {
  const query = String(i.options.getFocused() || '').trim().slice(0,80);
  if (!query) return i.respond([]);
  const key=query.toLocaleLowerCase('pt-BR');
  const cached=suggestionCache.get(key);
  if(cached && Date.now()-cached.time < SUGGESTIONS_TTL_MS)return i.respond(cached.choices);
  let list=[];
  try {
    // Mostra resultados locais a partir de uma letra e consulta a Steam a partir de duas.
    const local=db.prepare("SELECT offer_key,title,price_cents,currency FROM offers WHERE source='steam' AND lower(title) LIKE ? ORDER BY changed_at DESC LIMIT 25").all(`%${query.toLowerCase()}%`);
    list=local.map(o=>({key:o.offer_key,title:o.title,priceCents:o.price_cents,currency:o.currency}));
    if(query.length>=2) {
      try { const remote=await findGames(query,1800);list=[...remote,...list]; }
      catch(err){log('Autocomplete: consulta externa indisponível:',err.message);}
    }
  } catch(err){log('Autocomplete: erro:',err.message);}
  const unique=new Map();
  for(const item of list){if(!unique.has(item.key))unique.set(item.key,item);}
  const choices=[...unique.values()].slice(0,25).map(o=>({name:short(`${o.title} — ${stores.formatMoney(o.priceCents,o.currency)}`,100),value:o.key}));
  suggestionCache.set(key,{time:Date.now(),choices});
  if(suggestionCache.size>80)suggestionCache.delete(suggestionCache.keys().next().value);
  return i.respond(choices);
}
async function onBuscarCommand(i) {
  await i.deferReply({flags:MessageFlags.Ephemeral});
  const value=String(i.options.getString('jogo') || '').trim();
  if(/^steam:(app|sub):\d+$/.test(value)) {
    const offer=dbApi.getOffer(db,value);
    if(!offer)return i.editReply({embeds:[intro('Jogo não encontrado','Esta sugestão não está mais disponível. Faça uma nova pesquisa.')],components:rows(btn('gd:search','Pesquisar no painel',ButtonStyle.Primary,'🔎'))});
    return i.editReply(offerView(offer,i.user.id));
  }
  if(value.length<2)return i.editReply('Digite ao menos 2 letras para pesquisar.');
  try {return i.editReply(searchResultsView(value,await findAllGames(value)));}
  catch(err){log('Falha na pesquisa:',err.message);return i.editReply('Não foi possível consultar a Steam agora. Tente novamente.');}
}
async function registerGuildCommand(guild) {
  try {
    const existing=await guild.commands.fetch();
    if(!existing.some(c=>c.name==='buscar'))await guild.commands.create(searchCommand.toJSON());
  } catch(err){log('Não foi possível registrar /buscar no servidor',guild.id,err.message);}
}


function listView(kind, page=0) {
  const list = kind==='free'?dbApi.freeGames(db,75):kind==='partners'?db.prepare("SELECT * FROM offers WHERE source LIKE 'cs:%' AND discount>0 AND seen_at>? ORDER BY discount DESC, seen_at DESC LIMIT 75").all(Date.now()-7*86400000):kind==='bundles'?dbApi.recentDeals(db,0,75).filter(o=>o.kind==='sub'):dbApi.recentDeals(db,0,75);
  const actualPage=Math.max(0,Math.min(page,Math.max(0,Math.ceil(list.length/OFFER_PAGE_SIZE)-1)));
  const slice=list.slice(actualPage*OFFER_PAGE_SIZE,actualPage*OFFER_PAGE_SIZE+OFFER_PAGE_SIZE);
  const titles={free:'🎁 Jogos grátis temporários',offers:'🏷️ Promoções na Steam',partners:'🏬 Promoções de outras lojas',bundles:'📦 Pacotes em promoção'};
  const heading=intro(titles[kind],slice.length?`Banners grandes e descontos registrados. **2 jogos por página**. ${kind==='partners'?'Ofertas internacionais em **USD**, via CheapShark. Confirmar disponibilidade no Brasil e preço final.':''} Selecione um jogo para detalhes e alertas.`:'Nenhuma oferta recente nessa categoria. A fonte pode ainda não ter sido consultada.');
  heading.addFields({name:'📄 Página',value:`${actualPage+1}/${Math.max(1,Math.ceil(list.length/OFFER_PAGE_SIZE))}`,inline:true});
  const buttons=[];
  if(actualPage>0)buttons.push(btn(`gd:page:${kind}:${actualPage-1}`,'Anterior',ButtonStyle.Secondary,'⬅️'));
  if((actualPage+1)*OFFER_PAGE_SIZE<list.length)buttons.push(btn(`gd:page:${kind}:${actualPage+1}`,'Próxima',ButtonStyle.Secondary,'➡️'));
  const result={embeds:[heading,...slice.map((o,i)=>productCard(o,actualPage*OFFER_PAGE_SIZE+i+1))],components:buttons.length?rows(...buttons):[]};
  if(slice.length) result.components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:offer').setPlaceholder('🎮 Abrir ficha do jogo').addOptions(slice.map(o=>({label:short(o.title,95),description:short(`${stores.formatMoney(o.price_cents,o.currency)} • ${shopName(o.source)}`,100),value:o.offer_key})))));
  return result;
}

function offerView(o, userId) {
  const isWatched=Boolean(db.prepare('SELECT 1 FROM watchlist WHERE user_id=? AND offer_key=?').get(userId,o.offer_key));
  return {embeds:[offerEmbed(o)],components:[...rows(
    btn(`gd:watch:${o.offer_key}`,isWatched?'Parar de seguir':'Acompanhar',isWatched?ButtonStyle.Danger:ButtonStyle.Success,isWatched?'🗑️':'❤️'),
    btn(`gd:target:${o.offer_key}`,'Definir alerta',ButtonStyle.Secondary,'🔔'),
    btn(`gd:history:${o.offer_key}`,'Histórico',ButtonStyle.Secondary,'📈'),
    btn(`gd:compare:${o.offer_key}`,'Comparar lojas',ButtonStyle.Secondary,'🏬')), shopLink(o)]};
}
function historyView(key) {
  const o=dbApi.getOffer(db,key);
  if(!o)return {embeds:[intro('Histórico','Oferta não encontrada.')],components:[]};
  const arr=db.prepare('SELECT price_cents,currency,recorded_at FROM price_history WHERE offer_key=? ORDER BY recorded_at DESC LIMIT 20').all(key);
  const amounts=arr.map(x=>x.price_cents);
  const low=amounts.length?Math.min(...amounts):null;
  const high=amounts.length?Math.max(...amounts):null;
  const chars='▁▂▃▄▅▆▇█';
  const trend=[...amounts].reverse().map(n=>chars[Math.round((n-(low||0))/Math.max(1,(high||0)-(low||0))*7)]).join('');
  const description=`**Preço mais recente:** ${stores.formatMoney(o.price_cents,o.currency)}\n`+
    (low===null?'Sem registros para este produto.':`**Menor preço registrado pelo GameDeals:** ${stores.formatMoney(low,o.currency)}\n**Maior preço registrado:** ${stores.formatMoney(high,o.currency)}\n**Evolução:** ${trend}\n\n`+
    arr.slice(0,8).map(x=>`<t:${Math.floor(x.recorded_at/1000)}:d> — ${stores.formatMoney(x.price_cents,x.currency)}`).join('\n'))+
    '\n\n*O histórico começa quando este bot passou a coletar os dados; não é o recorde histórico da loja.*';
  return {embeds:[intro('📈 Histórico • '+short(o.title,160),description)],components:[shopLink(o)]};
}
function compareView(key) {
  const product=dbApi.getOffer(db,key);
  if(!product)return {content:'Produto não encontrado. Faça uma nova pesquisa.'};
  const normalized=stores.cleanName(product.title);
  // Títulos e edições estritamente iguais. Não presumir que versões diferentes sejam equivalentes.
  const catalog=db.prepare('SELECT * FROM offers WHERE seen_at>? LIMIT 500').all(Date.now()-7*86400000);
  const matches=catalog.filter(o=>stores.cleanName(o.title)===normalized && o.kind===product.kind);
  const unique=[...new Map([product,...matches].map(o=>[o.offer_key,o])).values()];
  const currencies=[...new Set(unique.map(o=>o.currency))];
  const description=currencies.map(currency=>{
    const list=unique.filter(o=>o.currency===currency).sort((a,b)=>a.price_cents-b.price_cents);
    return `**${currency==='BRL'?'🇧🇷 Preços brasileiros (BRL)':'🌎 Valores internacionais (USD)'}**\n`+
      list.slice(0,12).map(o=>`**${shopName(o.source)}** — ${stores.formatMoney(o.price_cents,o.currency)}${o.discount?` • -${o.discount}%`:''}\n[Consultar oferta](${o.url})`).join('\n\n');
  }).join('\n\n');
  const note=unique.length<2?'\n\n⚠️ Ainda não há outra oferta com título e edição correspondentes.':'\n\n*Moedas diferentes não são comparáveis diretamente. Preços podem variar por região e data. Confirme o checkout.*';
  return {embeds:[intro('🏬 Comparar • '+short(product.title,130),short(description+note,3900))],components:[shopLink(product)]};
}

function modal(id,title,label,placeholder) { return new ModalBuilder().setCustomId(id).setTitle(short(title,42)).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))); }

async function interactionReply(interaction, data) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({flags:MessageFlags.Ephemeral});
  return interaction.editReply(data);
}
function canAdmin(i){return Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));}

async function onButton(i) {
  const id=i.customId;
  if(id==='gd:search') return i.showModal(modal('gd:search:submit','Pesquisar nas lojas','Nome do jogo','Ex.: Red Dead Redemption 2'));
  if (id.startsWith('gd:target:')) {
    const key=id.slice('gd:target:'.length);
    if(!dbApi.getOffer(db,key)) return interactionReply(i,{content:'Oferta não encontrada.'});
    return i.showModal(modal(`gd:targetsave:${key}`,'Alerta personalizado',`Preço máximo em ${dbApi.getOffer(db,key).currency}`,'49,90 ou 9.99'));
  }
  if (id==='gd:settings') {
    if(!canAdmin(i)) return interactionReply(i,{content:'Somente membros com Gerenciar Servidor podem alterar estas configurações.'});
    const g=dbApi.getGuild(db,i.guildId);
    return interactionReply(i,{embeds:[intro('⚙️ Administração',`Notificações: **${g?.enabled?'Ligadas':'Desligadas'}**\nDesconto mínimo: **${g?.min_discount||0}%**\nLimite de preço: **${g?.max_price_cents===null?'Sem limite':stores.formatMoney(g.max_price_cents,'BRL')}** *(limite de preço em R$ não se aplica aos valores USD; nesse caso, anúncios USD ficam ocultos quando há limite)*\n\nEscolha uma opção abaixo.`)],components:rows(btn('gd:toggle','Ligar/desligar avisos',ButtonStyle.Primary,'🔔'),btn('gd:discount','Alterar desconto mínimo',ButtonStyle.Secondary,'🏷️'),btn('gd:sample','Publicar 3 ofertas',ButtonStyle.Secondary,'📢'),btn('gd:pricecap','Limite de preço',ButtonStyle.Secondary,'💰'),btn('gd:refresh','Atualizar agora',ButtonStyle.Secondary,'🔄'))});
  }
  if(id==='gd:toggle' && canAdmin(i)) {
    const g=dbApi.getGuild(db,i.guildId); db.prepare('UPDATE guilds SET enabled=? WHERE guild_id=?').run(g?.enabled?0:1,i.guildId);
    return interactionReply(i,{content:`Notificações ${g?.enabled?'desativadas':'ativadas'} neste servidor.`});
  }
  if(id==='gd:discount' && canAdmin(i)) return interactionReply(i,{content:'Selecione o desconto mínimo para anúncios automáticos:',components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:discount:select').addOptions([0,20,30,50,70,90].map(n=>({label:`${n}%`,value:String(n)}))))]});
  if(id==='gd:pricecap' && canAdmin(i))return interactionReply(i,{content:'Selecione o valor máximo de uma oferta para notificações automáticas (em BRL):',components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gd:pricecap:select').addOptions([{label:'Sem limite',value:'all'},...[20,50,100,150,200,300].map(n=>({label:`Até R$ ${n}`,value:String(n)}))]))]});
  if(id==='gd:refresh' && canAdmin(i)){
    if(pollActive)return interactionReply(i,{content:'Uma consulta já está em andamento.'});
    if(Date.now()-lastManualPoll<5*60000)return interactionReply(i,{content:'Aguarde pelo menos 5 minutos entre atualizações manuais.'});
    lastManualPoll=Date.now();
    await i.deferReply({flags:MessageFlags.Ephemeral});
    await poll();
    return i.editReply('🔄 Consulta finalizada. Abra **Status** para ver cada fonte e possíveis erros.');
  }
  if(id==='gd:sample' && canAdmin(i)) {
    await interactionReply(i,{content:'Publicando até 3 ofertas recentes no canal de notificações...'});
    const g=dbApi.getGuild(db,i.guildId); const c=await client.channels.fetch(g.deals_channel);
    const sample=dbApi.recentDeals(db,g.min_discount,20).filter(o=>g.max_price_cents===null||(o.currency==='BRL'&&o.price_cents<=g.max_price_cents)).slice(0,3);
    if(!sample.length) return i.editReply('Ainda não existem promoções recentes armazenadas.');
    let n=0;for(const o of sample){try{await c.send({embeds:[offerEmbed(o)],components:[shopLink(o)]});n++;}catch(err){log('Falha no exemplo',err.message);}}
    return i.editReply(`Publiquei ${n} oferta(s) no canal <#${g.deals_channel}>.`);
  }
  if(id.startsWith('gd:page:')) {
    const [, ,kind,page]=id.split(':');
    // Edita a mensagem efemera existente para paginar sem acumular respostas.
    return i.update(listView(kind,Number(page)||0));
  }
  if(id==='gd:offers' || id==='gd:free' || id==='gd:bundles' || id==='gd:partners') return interactionReply(i,listView(id.slice(3)));
  if(id==='gd:help') return interactionReply(i,{embeds:[intro('❓ Como usar','**Pesquisar:** busca na Steam e em lojas autorizadas com capas e abre a ficha com banner; `/buscar` sugere jogos enquanto você digita.\n**Acompanhar:** salva o produto na sua lista pessoal.\n**Definir alerta:** você recebe DM se o bot identificar um preço igual ou abaixo do limite (quando DMs são permitidas).\n**Jogos grátis:** resgates temporários encontrados na Epic Games.\n**Histórico:** evolução dos preços registrados pelo bot.\n**Comparar lojas:** mostra somente valores realmente consultados para o mesmo título e edição.\n\nOutras lojas vêm do CheapShark em USD. Nuuvem e Instant Gaming ainda não estão conectadas. Não enviamos ofertas fictícias nem prometemos cobertura de todas as lojas.')]});
  if(id==='gd:status') {
    const states=db.prepare('SELECT * FROM sources').all();
    const status=states.length?states.map(s=>`${s.source==='steam'?'Steam':s.source==='epic'?'Epic':'Outras lojas (CheapShark)'}: ${s.last_error?'⚠️ '+short(s.last_error,90):'✅ OK'} • ${s.item_count} itens • <t:${Math.floor(s.checked_at/1000)}:R>`).join('\n'):'Coleta ainda não iniciada.';
    return interactionReply(i,{embeds:[intro('📡 Estado do monitor',`${status}\n\nVerificações gerais a cada **${POLL_MS/60000} minutos**, com até **${WISHLIST_CHECK_LIMIT}** jogos acompanhados revisados por ciclo. Os horários refletem a coleta, não necessariamente a atualização da loja.`)]});
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
  if(id.startsWith('gd:compare:')) {
    const key=id.slice('gd:compare:'.length),product=dbApi.getOffer(db,key);
    if(!product)return interactionReply(i,{content:'Oferta não encontrada.'});
    await i.deferReply({flags:MessageFlags.Ephemeral});
    let warning='';
    try {
      const linked=await shark.searchByTitle(product.title);
      for(const o of linked)if(stores.cleanName(o.title)===stores.cleanName(product.title))dbApi.upsertOffer(db,o);
    } catch(e){warning='\n\n⚠️ Não foi possível atualizar os preços de outras lojas agora.';log('Comparação CheapShark',e.message);}
    const result=compareView(key);
    if(warning && result.embeds)result.embeds[0].setDescription(result.embeds[0].data.description+warning);
    return i.editReply(result);
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
    if(val.startsWith('cs:')) {
      const offer=dbApi.getOffer(db,val);
      return interactionReply(i,offer?offerView(offer,i.user.id):{content:'Essa oferta não está mais no cache. Pesquise novamente.'});
    }
    const [,type,rawId]=val.split(':');const idNum=Number(rawId);
    if(!['app','sub'].includes(type)||!Number.isSafeInteger(idNum))return interactionReply(i,{content:'Produto inválido.'});
    const key=`steam:${type}:${idNum}`;
    let o=dbApi.getOffer(db,key);
    if(!o) return interactionReply(i,{content:'Este produto não está mais no cache. Faça uma nova pesquisa.'});
    await i.deferReply({flags:MessageFlags.Ephemeral});
    try {const fresh=await stores.steamAppDetails(type,idNum);if(fresh){dbApi.upsertOffer(db,{key:o.offer_key,title:o.title,source:o.source,kind:o.kind,url:o.url,image:o.image,currency:fresh.currency,originalCents:fresh.originalCents,priceCents:fresh.priceCents,discount:fresh.discount,expiresAt:null});o=dbApi.getOffer(db,key);}}catch(err){log('Detalhes Steam indisponíveis:',err.message);}
    return interactionReply(i,offerView(o,i.user.id));
  }
  if(id==='gd:pricecap:select'){
    if(!canAdmin(i))return interactionReply(i,{content:'Sem permissão.'});
    const cents=val==='all'?null:Number(val)*100;
    if(cents!==null && (!Number.isInteger(cents)||cents<0||cents>100000))return interactionReply(i,{content:'Valor inválido.'});
    db.prepare('UPDATE guilds SET max_price_cents=? WHERE guild_id=?').run(cents,i.guildId);
    return interactionReply(i,{content:val==='all'?'Limite de preço desativado.':`Notificações limitadas a ofertas de até ${stores.formatMoney(cents,'BRL')}.`});
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
    try {return i.editReply(searchResultsView(value,await findAllGames(value)));}
    catch(err){return i.editReply(`Não consegui consultar a Steam agora (${short(err.message,120)}). Tente novamente mais tarde.`);}
  }
  if(id.startsWith('gd:targetsave:')) {
    const key=id.slice('gd:targetsave:'.length);const offer=dbApi.getOffer(db,key);
    if(!offer)return interactionReply(i,{content:'Oferta não encontrada.'});
    if(!['BRL','USD'].includes(offer.currency))return interactionReply(i,{content:'Esta moeda ainda não é suportada para alertas.'});
    const normalized=value.replace(/\s/g,'').replace(/^(R\$|US\$|\$)/i,'').replace(',','.');
    const parsed=Number(normalized);
    if(!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(normalized)||!Number.isFinite(parsed)||parsed<0||parsed>100000)return interactionReply(i,{content:'Valor inválido. Exemplo: 49,90'});
    const cents=Math.round(parsed*100);
    db.prepare('INSERT INTO watchlist(user_id,offer_key,target_cents,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,offer_key) DO UPDATE SET target_cents=excluded.target_cents').run(i.user.id,key,cents,Date.now());
    return interactionReply(i,{content:`🔔 Alerta para **${offer.title}** configurado em ${stores.formatMoney(cents,'BRL')}. ${offer.price_cents<=cents?'✅ O preço registrado já atende ao seu limite! Confira a loja.':'O bot verificará jogos acompanhados gradualmente e tentará enviar uma DM quando encontrar um novo preço dentro do limite.'}`});
  }
}

client.on('interactionCreate',async i=>{
  if (i.isAutocomplete()) {if(i.commandName==='buscar')try{await autocomplete(i);}catch(err){log('Erro no autocomplete:',err.message);try{await i.respond([]);}catch{}} return;}
  if (i.isChatInputCommand()) {if(i.commandName==='buscar')try{await onBuscarCommand(i);}catch(err){log('Erro no /buscar:',err.message);if(i.deferred||i.replied)await i.editReply('Ocorreu um erro ao pesquisar.');else await i.reply({content:'Ocorreu um erro ao pesquisar.',flags:MessageFlags.Ephemeral});}return;}
  if(!i.isButton() && !i.isStringSelectMenu() && !i.isModalSubmit())return;
  if(!i.customId.startsWith('gd:'))return;
  if(!i.guildId)return i.reply({content:'Abra o painel dentro de um servidor.',flags:MessageFlags.Ephemeral});
  try {if(i.isButton())await onButton(i);else if(i.isStringSelectMenu())await onSelect(i);else await onModal(i);}
  catch(e){log('Falha na interação',i.customId,e.stack||e.message);try{if(i.deferred||i.replied)await i.editReply({content:'Ocorreu um erro temporário. Tente novamente.'});else await i.reply({content:'Ocorreu um erro temporário. Tente novamente.',flags:MessageFlags.Ephemeral});}catch{}}
});

async function announce(o) {
  const guilds=db.prepare('SELECT * FROM guilds WHERE enabled=1 AND deals_channel IS NOT NULL').all();
  for(const g of guilds) {
    if(o.source!=='epic' && o.discount<g.min_discount)continue;
    if(g.max_price_cents!==null && (o.currency!=='BRL'||o.priceCents>g.max_price_cents))continue;
    if(o.source==='epic' && o.price_cents!==0)continue;
    if(db.prepare('SELECT 1 FROM notifications WHERE guild_id=? AND offer_key=? AND price_cents=?').get(g.guild_id,o.key,o.priceCents))continue;
    try {
      const channel=await client.channels.fetch(g.deals_channel);
      if(!channel?.isTextBased())continue;
      await channel.send({embeds:[offerEmbed({offer_key:o.key,title:o.title,url:o.url,price_cents:o.priceCents,original_cents:o.originalCents,currency:o.currency,discount:o.discount,source:o.source,kind:o.kind,image:o.image,expires_at:o.expiresAt})],components:[shopLink(o)]});
      db.prepare('INSERT OR IGNORE INTO notifications(guild_id,offer_key,price_cents,delivered_at) VALUES(?,?,?,?)').run(g.guild_id,o.key,o.priceCents,Date.now());
      await new Promise(r=>setTimeout(r,1000));
    } catch(e){log('Falha ao notificar servidor',g.guild_id,e.message);}
  }
}

async function notifyWatchers(o) {
  if(!['BRL','USD'].includes(o.currency))return;
  const users=db.prepare('SELECT user_id FROM watchlist WHERE offer_key=? AND target_cents IS NOT NULL AND target_cents>=?').all(o.key,o.priceCents);
  for(const {user_id} of users){
    if(db.prepare('SELECT 1 FROM dm_notifications WHERE user_id=? AND offer_key=? AND price_cents=?').get(user_id,o.key,o.priceCents))continue;
    try {
      const u=await client.users.fetch(user_id);
      await u.send({content:`🔔 Seu alerta de preço foi atingido!`,embeds:[offerEmbed({offer_key:o.key,title:o.title,url:o.url,price_cents:o.priceCents,original_cents:o.originalCents,currency:o.currency,discount:o.discount,source:o.source,kind:o.kind,image:o.image,expires_at:o.expiresAt})],components:[shopLink(o)]});
      db.prepare('INSERT OR IGNORE INTO dm_notifications(user_id,offer_key,price_cents,delivered_at) VALUES(?,?,?,?)').run(user_id,o.key,o.priceCents,Date.now());
    } catch(e){log('Não foi possível enviar DM',user_id,e.message);}
  }
}

async function refreshWatchlist() {
  const items=db.prepare("SELECT DISTINCT w.offer_key FROM watchlist w JOIN offers o ON o.offer_key=w.offer_key WHERE o.source='steam' AND o.kind='app' ORDER BY w.offer_key").all();
  if(!items.length)return;
  const cursor=Number(db.prepare("SELECT value FROM meta WHERE key='watch_scan_cursor'").get()?.value)||0;
  const batch=Array.from({length:Math.min(WISHLIST_CHECK_LIMIT,items.length)},(_,i)=>items[(cursor+i)%items.length]);
  db.prepare("INSERT INTO meta(key,value) VALUES('watch_scan_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String((cursor+batch.length)%items.length));
  for(const {offer_key} of batch){
    const match=/^steam:app:(\d+)$/.exec(offer_key); if(!match)continue;
    try {
      const fresh=await stores.steamAppDetails('app',match[1]);
      const old=dbApi.getOffer(db,offer_key);
      if(fresh && old){
        const updated={key:old.offer_key,title:old.title,source:'steam',kind:'app',url:old.url,image:old.image,currency:fresh.currency,originalCents:fresh.originalCents,priceCents:fresh.priceCents,discount:fresh.discount,expiresAt:null};
        if(dbApi.upsertOffer(db,updated))await notifyWatchers(updated);
      }
    }catch(err){log('Falha ao verificar jogo acompanhado',offer_key,err.message);}
    await new Promise(resolve=>setTimeout(resolve,700));
  }
}
async function poll() {
  if(pollActive)return;
  pollActive=true;
  try {
    const sources=[['steam',stores.steamSpecials],['epic',stores.epicFreeGames]];
    for(const [source,reader] of sources){
      try {
        const offers=await reader();let updated=0;
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
      }catch(err){dbApi.setSource(db,source,0,err.message);log('Falha na fonte',source,err.message);}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    // Uma única página pequena a cada 4 horas: sem varrer o catálogo completo.
    const last=db.prepare("SELECT checked_at,last_error FROM sources WHERE source='cheapshark'").get();
    const age=Date.now()-(last?.checked_at||0);
    if(age>=(last?.last_error?60:240)*60*1000) {
      try {
        const offers=await shark.featured();let changedCount=0;let sent=0;
        for(const o of offers) {
          if(dbApi.upsertOffer(db,o)){
            changedCount++;
            if(initializedSources.has('cheapshark')) {
              if(sent<6){await announce(o);sent++;}
              await notifyWatchers(o);
            }
          }
        }
        dbApi.setSource(db,'cheapshark',offers.length);
        if(!initializedSources.has('cheapshark')) {
          db.prepare("INSERT INTO meta(key,value) VALUES('source_init:cheapshark','yes') ON CONFLICT(key) DO UPDATE SET value='yes'").run();
          initializedSources.add('cheapshark');
          log('CheapShark iniciado sem publicar em massa os descontos anteriores.');
        }
        log(`CheapShark: ${offers.length} produtos na amostra, ${changedCount} novos preços, ${sent} avisos.`);
      } catch(e){dbApi.setSource(db,'cheapshark',0,e.message);log('Falha no CheapShark',e.message);}
    }
    await refreshWatchlist();
  }finally{pollActive=false;}
}

client.once('ready',async()=>{
  log(`Online como ${client.user.tag} (${client.guilds.cache.size} servidores)`);
  for(const guild of client.guilds.cache.values()){try{await ensureGuild(guild);await registerGuildCommand(guild);}catch(e){log('Falha ao instalar painel',guild.name,e.message);}}
  await poll();
  dbApi.backupDb(db).then(file=>log('Backup local',file)).catch(e=>log('Falha no backup',e.message));
  setInterval(()=>poll().catch(e=>{log('Falha na varredura',e.message);}),POLL_MS);
  setInterval(()=>dbApi.backupDb(db).then(file=>log('Backup local',file)).catch(e=>log('Falha no backup',e.message)),24*60*60*1000);
});
client.on('guildCreate',async guild=>{try{await ensureGuild(guild);await registerGuildCommand(guild);}catch(e){log('Falha ao instalar novo servidor',e.message);}});
client.on('error',e=>log('Erro Discord',e.message));
process.on('unhandledRejection',e=>log('Promise rejeitada',e));
process.on('SIGTERM',()=>{db.close();client.destroy();process.exit(0);});
client.login(process.env.DISCORD_TOKEN).catch(e=>{console.error('Falha no login do bot:',e.message);process.exit(1);});