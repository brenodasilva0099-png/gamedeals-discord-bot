'use strict';

// Prioriza imagens fornecidas pela Steam/Epic. URLs montadas são apenas fallback.
function safeImageUrl(value) {
  if (typeof value !== 'string') return null;
  let url = value.trim();
  if (!url) return null;
  if (url.startsWith('//')) url = 'https:' + url;
  if (/^http:\/\/[^/]*steamstatic\.com\//i.test(url)) url = 'https://' + url.slice(7);
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}

function steamFallback(offer) {
  const key = offer?.offer_key || offer?.key || '';
  const found = /^steam:(app|sub):(\d+)$/.exec(key);
  if (!found) return null;
  const folder = found[1] === 'sub' ? 'subs' : 'apps';
  return 'https://shared.fastly.steamstatic.com/store_item_assets/steam/' +
    folder + '/' + found[2] + '/header.jpg';
}

function coverFor(offer) {
  // Um título pode usar um caminho oficial com hash: não substituir pela URL genérica.
  return safeImageUrl(offer?.image) || steamFallback(offer);
}

module.exports = { safeImageUrl, steamFallback, coverFor };
