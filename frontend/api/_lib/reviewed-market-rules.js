import { ethers } from 'ethers';
import { FEEDS_ARBITRUM_ONE } from './chainlink.js';
import { nationalTeamMarketTranslations } from './national-team-labels.js';
import { REVIEWED_CHAIN_ID, reviewedCreationError } from './reviewed-market-settings.js';

function requireRule(condition, detail) {
  if (!condition) throw reviewedCreationError('reviewed_rules_incomplete', detail);
}

function soccerRules(row) {
  const cfg = row.resolver_config || {};
  const source = row.source_data || {};
  const league = /^soccer\/([a-z0-9_.-]+)$/.exec(cfg.leaguePath || '')?.[1];
  const event = String(cfg.eventId || '');
  const home = source.home?.name;
  const away = source.away?.name;
  const kickoff = Date.parse(source.kickoffUtc);
  requireRule(cfg.source === 'espn' && cfg.shape === 'draw3' && league && /^\d+$/.test(event)
    && row.resolver_type === 'sports_api' && row.source_event_id === `${league}:${event}`
    && league === source.leagueCode && event === String(source.eventId)
    && [home, away].every(name => typeof name === 'string' && name.trim() && !/[\r\n]/.test(name)) && home !== away
    && /^\d+$/.test(String(source.home.id)) && /^\d+$/.test(String(source.away.id))
    && String(source.home.id) !== String(source.away.id)
    && Number.isFinite(kickoff) && kickoff === Date.parse(row.start_time)
    && kickoff % 1000 === 0 && Date.parse(row.end_time) >= kickoff,
  'The ESPN event, teams, and scheduled kickoff must match the pending row.');
  const labels = nationalTeamMarketTranslations({ leagueCode: league, homeName: home, awayName: away })?.es;
  const outcomes = labels?.outcomes || [home, 'Empate', away];
  requireRule(row.question === (labels?.question || `${home} vs ${away}`)
    && JSON.stringify(row.outcomes) === JSON.stringify(outcomes),
  'The question and outcome order must match the ESPN fixture.');
  return {
    template: 'espn-soccer-regulation-v1',
    version: 'v2',
    cutoff: new Date(kickoff).toISOString(),
    source: `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${event}`,
    terms: [
      `Partido ESPN ${league}:${event}. Local: ${home} (${source.home.id}). Visitante: ${away} (${source.away.id}).`,
      `0: ${outcomes[0]} gana. 1: empate. 2: ${outcomes[2]} gana.`,
      'Cuenta el marcador al final del tiempo reglamentario, incluido el tiempo añadido. Se excluyen la prórroga y los penales.',
      'Si el partido se aplaza, se mantiene el cierre original. Cuenta únicamente el mismo evento con los mismos equipos si termina dentro de los siete días siguientes al cierre.',
      'Se cancela si el partido se abandona, cambia de equipos, se decide administrativamente, supera ese plazo o ESPN no permite verificar el marcador reglamentario. No se sustituye la fuente.',
    ],
  };
}

function cryptoRules(row) {
  const cfg = row.resolver_config || {};
  const source = row.source_data || {};
  const asset = source.asset;
  const feed = ['BTC', 'ETH'].includes(asset) ? FEEDS_ARBITRUM_ONE[`${asset}_USD`] : null;
  const cutoff = new Date(row.end_time);
  requireRule(feed && row.resolver_type === 'chainlink_price' && !cfg.shape
    && cfg.chainId === REVIEWED_CHAIN_ID && cfg.symbol === feed.symbol && cfg.op === 'gt' && cfg.yesOutcome === 0
    && feed.feedAddress.toLowerCase() === String(cfg.feedAddress).toLowerCase()
    && feed.feedAddress.toLowerCase() === String(source.feed).toLowerCase()
    && Number.isSafeInteger(cfg.threshold) && cfg.threshold > 0 && cfg.threshold === source.strike
    && Number.isFinite(cutoff.getTime()) && cutoff.getUTCDay() === 0
    && cutoff.toISOString().endsWith('T23:59:00.000Z') && !row.start_time
    && (!cfg.closesAt || Date.parse(cfg.closesAt) === cutoff.getTime()),
  'The generated BTC/USD or ETH/USD feed, strike, and Sunday UTC cutoff must match.');
  const date = cutoff.toISOString().slice(0, 10);
  const displayDate = date.split('-').reverse().join('/');
  requireRule(row.source_event_id === `crypto:${asset}:${date}:${cfg.threshold}`
    && row.question === `¿${asset} cerrará por encima de $${cfg.threshold.toLocaleString('es-MX')} USD el ${displayDate}?`
    && JSON.stringify(row.outcomes) === '["Sí","No"]',
  'The question, strike, date, and Sí/No outcomes must match the generated price market.');
  return {
    template: 'chainlink-weekly-threshold-v1',
    version: 'v1',
    cutoff: cutoff.toISOString(),
    source: `https://arbiscan.io/address/${feed.feedAddress}`,
    terms: [
      `Feed Chainlink ${feed.symbol} en Arbitrum One (42161), contrato ${feed.feedAddress}.`,
      'Se usa la última ronda válida del feed con precio positivo y hora de actualización igual o anterior al cierre. Debe haberse actualizado en la hora anterior al cierre o en el mismo instante.',
      `Sí si el precio es estrictamente mayor que ${cfg.threshold} USD. No si es igual o inferior. Se usa el valor del feed con sus decimales, sin redondear.`,
      'Se cancela si no se puede verificar una ronda válida dentro de esa ventana. No se usa una ronda posterior ni se sustituye la fuente.',
    ],
  };
}

export function reviewedMarketRules(row, now = Date.now()) {
  requireRule(row.amm_mode === 'unified' && ['deportes', 'crypto'].includes(row.category) && !row.is_test_market,
    'Only non-test unified markets can use reviewed creation.');
  const build = { 'espn-soccer': soccerRules, chainlink: cryptoRules };
  requireRule(Object.hasOwn(build, row.source), 'This source has no approved automatic rules template.');
  const rules = build[row.source](row);
  requireRule(Date.parse(rules.cutoff) > now, 'Trading cutoff must still be in the future.');
  const content = [
    `Plantilla: ${rules.template}`,
    `Pregunta: ${row.question}`,
    `Resultados (en orden): ${JSON.stringify(row.outcomes)}`,
    `Cierre de negociación y zona horaria: ${rules.cutoff} (UTC)`,
    `Fuente: ${rules.source}`,
    ...rules.terms,
    '',
  ].join('\n');
  return { ...rules, content, rulesHash: ethers.utils.id(content) };
}

export function supportsSepoliaReviewedShape(ammMode, outcomes) {
  return ammMode !== 'parallel' && Array.isArray(outcomes) && outcomes.length >= 2 && outcomes.length <= 8
    && outcomes.every(label => typeof label === 'string' && label.trim());
}

export function sepoliaReviewedRules({ row, outcomes, endDate, criteria, sourceUrl }, now = Date.now()) {
  const cutoffMs = Math.floor(endDate.getTime() / 1000) * 1000;
  if (!supportsSepoliaReviewedShape(row.amm_mode, outcomes)) {
    throw reviewedCreationError('reviewed_market_shape_unsupported',
      'La revisión onchain admite un solo pool con 2 a 8 resultados.');
  }
  requireRule(cutoffMs > now && typeof criteria === 'string' && criteria.trim(),
    'Agrega criterios de resolución y un cierre futuro.');
  const cutoff = new Date(cutoffMs).toISOString();
  const content = [
    'Pronos · Reglas de resolución · Arbitrum Sepolia',
    `Pregunta: ${row.question}`,
    `Resultados (en orden): ${JSON.stringify(outcomes)}`,
    `Cierre de negociación: ${cutoff} (UTC)`,
    `Fuente: ${sourceUrl || 'Según los criterios escritos'}`,
    criteria,
    '',
  ].join('\n');
  requireRule(Buffer.byteLength(content, 'utf8') <= 32768, 'El documento de reglas supera 32 KB.');
  return { version: outcomes.length === 2 ? 'v1' : 'v2', cutoff, content, rulesHash: ethers.utils.id(content) };
}
