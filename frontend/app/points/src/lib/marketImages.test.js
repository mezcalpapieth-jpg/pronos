import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanMarketImageRef,
  marketImageSrc,
  marketPlaceholderImageSrc,
  marketPlaceholderKey,
} from './marketImages.js';

const BADGE_PREFIX = 'data:image/svg+xml;utf8,';

function decodedBadgeSvg(src) {
  assert.equal(src.startsWith(BADGE_PREFIX), true);
  return decodeURIComponent(src.slice(BADGE_PREFIX.length));
}

test('market image refs allow external images and safe local placeholder paths', () => {
  assert.equal(cleanMarketImageRef('https://example.com/market.png'), 'https://example.com/market.png');
  assert.equal(cleanMarketImageRef('/market-placeholders/deportes.svg'), '/market-placeholders/deportes.svg');
  assert.equal(cleanMarketImageRef('/../secret.png'), null);
  assert.equal(cleanMarketImageRef('javascript:alert(1)'), null);
});

test('market image helper falls back to category and special placeholders', () => {
  assert.equal(marketPlaceholderKey({ category: 'deportes' }), 'deportes');
  assert.equal(marketPlaceholderKey({ category: 'general', question: 'Retrasos AICM mañana' }), 'aicm');
  assert.equal(marketPlaceholderKey({ category: 'mexico', topicTags: ['weather'] }), 'weather');
  assert.equal(marketPlaceholderImageSrc({ category: 'finanzas' }), '/market-placeholders/finanzas.svg');
  assert.equal(marketImageSrc({ imageUrl: '', category: 'crypto' }), '/market-placeholders/crypto.svg');
});

test('sports markets render league-specific badge art when league metadata is present', () => {
  const market = {
    category: 'deportes',
    sport: 'soccer',
    league: 'uefa-cl',
    question: '¿Real Madrid gana su partido de Champions League?',
  };
  assert.equal(marketPlaceholderKey(market), 'league:uefa-cl');
  const svg = decodedBadgeSvg(marketPlaceholderImageSrc(market));
  assert.match(svg, />UCL</);
  assert.match(svg, />Champions</);
});

test('crypto markets render coin-specific badge art from resolver metadata', () => {
  const market = {
    category: 'crypto',
    resolverConfig: { source: 'chainlink', shape: 'binary-direction', symbol: 'ETH/USD', asset: 'eth' },
  };
  assert.equal(marketPlaceholderKey(market), 'coin:eth');
  assert.match(decodedBadgeSvg(marketPlaceholderImageSrc(market)), />ETH</);
});

test('entertainment source markets render service and show badges', () => {
  const netflix = {
    category: 'musica',
    source: 'netflix-top10',
    sourceEventId: 'netflix-top10:mx:series:2026-09-08',
  };
  assert.equal(marketPlaceholderKey(netflix), 'source:netflix');
  assert.match(decodedBadgeSvg(marketPlaceholderImageSrc(netflix)), />NETFLIX</);

  const youtube = {
    category: 'musica',
    resolverConfig: { source: 'youtube-trending-mx' },
    topicTags: ['video'],
  };
  assert.equal(marketPlaceholderKey(youtube), 'source:youtube');
  assert.match(decodedBadgeSvg(marketPlaceholderImageSrc(youtube)), />YOUTUBE</);

  const granja = {
    category: 'musica',
    source: 'granja-vip-official',
    sourceEventId: 'granja-vip-elimination:2026-09-13',
    topicTags: ['tv', 'farandula'],
  };
  assert.equal(marketPlaceholderKey(granja), 'show:granja-vip');
  assert.match(decodedBadgeSvg(marketPlaceholderImageSrc(granja)), />GRANJA VIP</);
});

test('special and finance markets render sharper source badges without overriding explicit images', () => {
  const weather = { category: 'mexico', resolverType: 'weather_api', topicTags: ['weather'] };
  assert.equal(marketPlaceholderKey(weather), 'weather');
  assert.match(decodedBadgeSvg(marketPlaceholderImageSrc(weather)), />CLIMA</);

  const banxico = { category: 'finanzas', resolverConfig: { source: 'banxico-fix', symbol: 'USD/MXN' } };
  assert.equal(marketPlaceholderKey(banxico), 'source:banxico');
  assert.match(decodedBadgeSvg(marketPlaceholderImageSrc(banxico)), />BANXICO</);

  assert.equal(
    marketImageSrc({ imageUrl: 'https://example.com/custom.png', category: 'deportes', league: 'nba' }),
    'https://example.com/custom.png',
  );
});
