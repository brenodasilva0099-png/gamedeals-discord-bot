'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {coverFor, safeImageUrl, steamFallback} = require('../media');

test('prioriza imagem oficial da Steam mesmo quando a URL e diferente da convencional', () => {
  const offer = {offer_key:'steam:app:222222',image:'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/222222/abc123/header.jpg'};
  assert.equal(coverFor(offer),offer.image);
});
test('pacotes da Steam sem imagem usam pasta subs', () => {
  assert.equal(coverFor({offer_key:'steam:sub:333333',image:null}),
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/subs/333333/header.jpg');
});
test('jogos Steam sem imagem usam pasta apps', () => {
  assert.equal(coverFor({offer_key:'steam:app:444444'}),
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/444444/header.jpg');
});
test('mantem imagens Epic e normaliza URLs da Steam', () => {
  assert.equal(coverFor({offer_key:'epic:app:game-id',image:'https://cdn2.unrealengine.com/cover.jpg'}),
    'https://cdn2.unrealengine.com/cover.jpg');
  assert.equal(safeImageUrl('//shared.akamai.steamstatic.com/steam/apps/20/header.jpg'),
    'https://shared.akamai.steamstatic.com/steam/apps/20/header.jpg');
  assert.equal(safeImageUrl('http://shared.akamai.steamstatic.com/steam/apps/20/header.jpg'),
    'https://shared.akamai.steamstatic.com/steam/apps/20/header.jpg');
});
test('nao inventa URL para plataformas desconhecidas', () => {
  assert.equal(coverFor({offer_key:'epic:app:game-id',image:null}),null);
  assert.equal(safeImageUrl('javascript:alert(1)'),null);
  assert.equal(steamFallback({offer_key:'steam:bundle:123'}),null);
});
