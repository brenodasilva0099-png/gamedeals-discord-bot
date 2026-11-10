'use strict';

const STEAM_FEATURED = 'https://store.steampowered.com/api/featuredcategories/?cc=br&l=brazilian';
const EPIC_FREE = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR';

async function getJson(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'GameDealsDiscordBot/0.1 (respectful cache; contact repository maintainer)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function formatMoney(cents, currency = 'BRL') {
  if (!Number.isInteger(cents) || cents < 0) return 'Indisponível';
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100); }
  catch { return `${(cents/100).toFixed(2)} ${currency}`; }
}

function cleanName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function steamUrl(type, id) {
  return `https://store.steampowered.com/${type === 'sub' ? 'sub' : 'app'}/${Number(id)}/`;
}

function normalizeSteamItem(item) {
  if (!item || !Number.isInteger(Number(item.id)) || !item.name) return null;
  const type = item.type === 'sub' ? 'sub' : 'app';
  const finalCents = Number(item.final_price ?? item.price?.final);
  const initialCents = Number(item.original_price ?? item.price?.initial ?? finalCents);
  if (!Number.isInteger(finalCents) || finalCents < 0) return null;
  const currency = item.currency || item.price?.currency || 'BRL';
  return {
    key: `steam:${type}:${item.id}`, source: 'steam', kind: type,
    title: String(item.name).slice(0, 180), url: steamUrl(type, item.id),
    image: item.header_image || item.tiny_image || null,
    currency, originalCents: Number.isInteger(initialCents) ? initialCents : finalCents,
    priceCents: finalCents,
    discount: Math.max(0, Math.min(100, Number(item.discount_percent ?? (initialCents > 0 ? Math.round(100 * (1 - finalCents / initialCents)) : 0)) || 0)),
    expiresAt: null
  };
}

async function steamSpecials() {
  const data = await getJson(STEAM_FEATURED);
  if (!Array.isArray(data?.specials?.items)) throw new Error('Resposta inesperada da Steam');
  return data.specials.items.map(normalizeSteamItem).filter(x => x && x.discount > 0);
}

async function searchSteam(term) {
  const q = String(term || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const params = new URLSearchParams({ term: q, cc: 'br', l: 'brazilian' });
  const data = await getJson(`https://store.steampowered.com/api/storesearch/?${params}`);
  return (Array.isArray(data?.items) ? data.items : []).map(normalizeSteamItem).filter(Boolean).slice(0, 10);
}

async function steamAppDetails(type, id) {
  if (type !== 'app' && type !== 'sub') throw new Error('Tipo de produto inválido');
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error('ID inválido');
  if (type === 'sub') return null;
  const data = await getJson(`https://store.steampowered.com/api/appdetails/?appids=${Number(id)}&cc=br&l=brazilian&filters=price_overview`);
  const entry = data?.[String(id)];
  const price = entry?.data?.price_overview;
  if (!entry?.success || !price || !Number.isInteger(price.final)) return null;
  return { priceCents: price.final, originalCents: price.initial, currency: price.currency || 'BRL', discount: price.discount_percent || 0 };
}

function epicOffersFromResponse(data, now = Date.now()) {
  const elements = data?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) throw new Error('Resposta inesperada da Epic');
  const result = [];
  for (const game of elements) {
    if (!game?.title || !game?.id || (game.offerType && game.offerType !== 'BASE_GAME')) continue;
    const groups = game?.promotions?.promotionalOffers || [];
    const promo = groups.flatMap(g => g.promotionalOffers || []).find(o => {
      const start = Date.parse(o.startDate), end = Date.parse(o.endDate);
      return Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end && o.discountSetting?.discountPercentage === 0;
    });
    if (!promo) continue;
    const originalCents = Number(game?.price?.totalPrice?.originalPrice || 0);
    if (!Number.isInteger(originalCents) || originalCents <= 0) continue; // não notificar free-to-play
    const slug = game?.offerMappings?.[0]?.pageSlug || game?.catalogNs?.mappings?.[0]?.pageSlug || game?.productSlug || game?.urlSlug;
    const sanitized = typeof slug === 'string' && /^[a-z0-9_\-/]+$/i.test(slug) ? slug.split('/')[0] : null;
    const url = sanitized ? `https://store.epicgames.com/pt-BR/p/${sanitized}` : 'https://store.epicgames.com/pt-BR/free-games';
    const images = game?.keyImages || [];
    const cover = images.find(x => x.type === 'OfferImageWide') || images.find(x => x.type === 'Thumbnail') || images[0];
    result.push({ key: `epic:app:${game.id}`, source: 'epic', kind: 'app', title: game.title,
      url, image: cover?.url || null, currency: game?.price?.totalPrice?.currencyCode || 'BRL',
      originalCents, priceCents: 0, discount: 100, expiresAt: promo.endDate });
  }
  return result;
}

async function epicFreeGames() { return epicOffersFromResponse(await getJson(EPIC_FREE)); }

module.exports = { getJson, formatMoney, cleanName, normalizeSteamItem, steamSpecials, searchSteam, steamAppDetails, epicOffersFromResponse, epicFreeGames };
