/**
 * Market detail for the points-app.
 *
 * Mirrors the MVP's detail page behavior: a clean 2-column layout with
 * the market info + mini price chart on the left and a buy panel on the
 * right. Clicking a price button opens PointsBuyModal.
 *
 * Data comes from /api/points/market?id=... — the response contains
 * the market row + its current reserves, outcomes, and prices.
 */
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  cancelLimitOrder,
  fetchMarket,
  fetchMyLimitOrders,
  fetchOrderBook,
  fetchPriceHistory,
  fetchPositions,
  fetchTradeActivity,
  fetchTradeTape,
  createParlay,
  executeSell,
  placeLimitOrder,
  publicErrorMessage,
  quoteParlay,
  quoteSell,
  redeemWinnings,
} from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang, useT } from '@app/lib/i18n.js';
import { buildSellPreview, normalizeSellShares } from '../lib/sellPreview.js';
import {
  formatSeriesGameLabel,
  formatSeriesScoreSummary,
  formatSeriesSubtitle,
} from '@app/lib/seriesDisplay.js';
import {
  finalMarketOptions,
  findChampionsLeagueFinalMarket,
} from '@app/lib/championsLeague.js';
import Sparkline from '@app/components/Sparkline.jsx';
import MultiSparkline from '@app/components/MultiSparkline.jsx';
import LiveScorePanel from '@app/components/LiveScorePanel.jsx';
import ShareButton from '@app/components/ShareButton.jsx';
import TeamMarketStrip from '@app/components/TeamMarketStrip.jsx';
import TokenMarketStrip from '../components/TokenMarketStrip.jsx';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import PointsBuyModal from '../components/PointsBuyModal.jsx';
import PointsSellPreviewModal from '../components/PointsSellPreviewModal.jsx';
import PointsActivityTape from '../components/PointsActivityTape.jsx';
import MarketComments from '../components/MarketComments.jsx';
import Crypto5MinDetail from '../components/Crypto5MinDetail.jsx';
import TopHolders from '../components/TopHolders.jsx';
import CombinadaSlipPanel from '../components/CombinadaSlipPanel.jsx';
import CombinadaMarketPickerDrawer from '../components/CombinadaMarketPickerDrawer.jsx';
import {
  PARLAY_RULES_FALLBACK,
  addParlayLeg,
  buildParlayLeg,
  parlayPayloadLegs,
  readStoredParlaySlip,
  sanitizeParlaySlip,
  storeParlaySlip,
} from '../lib/combinadaSlip.js';
import {
  buildCryptoMarketSequence,
  cryptoMarketSequenceSignature,
} from '../lib/cryptoMarketHub.js';
import { marketInterestPayload, trackInterest } from '@app/lib/interest.js';
import { pointsPublicAssetSrc } from '@app/lib/publicAssets.js';
import { emitPointsRefresh } from '../lib/pointsLiveRefresh.js';
import { isVideoDemoActive, videoDemoPollMs } from '../demo/demoFlag.js';

const DemoTradeFlares = lazy(() => import('../demo/DemoTradeFlares.jsx'));

// Accent colors for the multi-line price chart. Match the buy-button
// accents so users recognize the same color for the same outcome.
// Palette wraps at N>8 (rare); MULTI_ACCENTS below is the matched
// border / background variant for the buy buttons.
// Muted on purpose (not var(--yes)/var(--gold), which are also used
// for unrelated success/positive states app-wide) — full-saturation
// hex read as neon against the near-black chart background.
const OUTCOME_COLORS = [
  '#3FAE72',               // green
  '#D9A63C',               // gold
  '#E2574F',               // red
  '#5D8EE0',               // blue
  '#A47FD1',               // purple
  '#4CB3C2',               // cyan
  '#D687A8',               // pink
  '#9CB84E',               // lime
];

const DETAIL_CHART_RANGES = [
  { key: '4h', hours: 4, days: 1, buckets: 48, limit: 240, labelKey: 'points.detail.range4h' },
  { key: '1', days: 1, buckets: 48, limit: 500, labelKey: 'points.detail.range24h' },
  { key: '7', days: 7, buckets: 56, limit: 500, labelKey: 'points.detail.range7d' },
  { key: '30', days: 30, buckets: 60, limit: 500, labelKey: 'points.detail.range30d' },
];

function detailChartRangeFor(key) {
  return DETAIL_CHART_RANGES.find(r => r.key === String(key)) || DETAIL_CHART_RANGES[0];
}

function summarizeActivity(activitySets) {
  const points = (Array.isArray(activitySets) ? activitySets : [])
    .flatMap(set => (Array.isArray(set) ? set : []))
    .filter(Boolean);
  const summary = points.reduce((acc, pt) => {
    const count = Number(pt.count || 0);
    const volume = Number(pt.volume || 0);
    const buyVolume = Number(pt.buyVolume || 0);
    const sellVolume = Number(pt.sellVolume || 0);
    const t = Number(pt.t || 0);
    return {
      count: acc.count + (Number.isFinite(count) ? count : 0),
      volume: acc.volume + (Number.isFinite(volume) ? volume : 0),
      buyVolume: acc.buyVolume + (Number.isFinite(buyVolume) ? buyVolume : 0),
      sellVolume: acc.sellVolume + (Number.isFinite(sellVolume) ? sellVolume : 0),
      lastAt: Number.isFinite(t) && t > acc.lastAt ? t : acc.lastAt,
    };
  }, {
    count: 0,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0,
    lastAt: 0,
  });
  const directionalVolume = summary.buyVolume + summary.sellVolume;
  return {
    ...summary,
    buyShare: directionalVolume > 0 ? summary.buyVolume / directionalVolume : null,
  };
}

function formatCompactMxnp(value, locale = 'es-MX') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return new Intl.NumberFormat(locale, {
    notation: n >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: n >= 1000 ? 1 : 0,
  }).format(n);
}

function formatActivityAge(unixSeconds, t) {
  const ts = Number(unixSeconds);
  if (!Number.isFinite(ts) || ts <= 0) return t('points.detail.activityNoTrades');
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (seconds < 60) return t('points.detail.activityNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('points.detail.activityMinutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('points.detail.activityHoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  return t('points.detail.activityDaysAgo', { n: days });
}

function unixSecondsFromDateLike(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

function signatureNumber(value, digits = 4) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '0';
}

function marketLiveSignature(market) {
  if (!market) return '';
  const prices = Array.isArray(market.prices)
    ? market.prices.map(p => signatureNumber(p))
    : [];
  const reserves = Array.isArray(market.reserves)
    ? market.reserves.map(r => signatureNumber(r, 2))
    : [];
  return JSON.stringify({
    id: market.id,
    status: market.status,
    outcome: market.outcome ?? null,
    resolvedAt: market.resolvedAt ?? null,
    lastTradeAt: market.lastTradeAt ?? null,
    tradeVolume: signatureNumber(market.tradeVolume || market.volume, 2),
    prices,
    reserves,
    next: market.cryptoMeta?.nextMarketId ?? null,
    prev: market.cryptoMeta?.prevMarketId ?? null,
    threshold: market.cryptoMeta?.threshold ?? null,
    sequence: market.cryptoMeta
      ? cryptoMarketSequenceSignature(buildCryptoMarketSequence(market))
      : '',
  });
}

// ── Chart watermark (Pronos brand mark, corner-anchored like Polymarket's) ──
function ChartWatermark() {
  return (
    <div style={{position:'absolute',top:2,right:14,opacity:0.55,pointerEvents:'none',userSelect:'none',zIndex:1}}>
      <span style={{fontFamily:'var(--font-display)',fontSize:13,letterSpacing:'0.05em',color:'var(--text-primary)'}}>PRONOS.IO</span>
    </div>
  );
}

function MarketActivityStrip({ summary, rangeLabel, lastTradeAt, locale = 'es-MX', t }) {
  const safeSummary = summary || {
    count: 0,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0,
    lastAt: 0,
    buyShare: null,
  };
  const latestTradeAt = Number(lastTradeAt) || Number(summary?.lastAt || 0);
  if ((!summary || summary.count <= 0) && latestTradeAt <= 0) {
    return (
      <div style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-muted)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        {t('points.detail.activityEmpty')}
      </div>
    );
  }
  const buyShare = safeSummary.buyShare == null ? null : Math.round(safeSummary.buyShare * 100);
  const sellShare = buyShare == null ? null : Math.max(0, 100 - buyShare);
  const pressureLabel = buyShare == null
    ? t('points.detail.activityNeutral')
    : buyShare >= 55
      ? t('points.detail.activityBuyPressure', { n: buyShare })
      : sellShare >= 55
        ? t('points.detail.activitySellPressure', { n: sellShare })
        : t('points.detail.activityBalanced');
  const count = Number(safeSummary.count || 0);
  const volume = Number(safeSummary.volume || 0);
  return (
    <div style={{
      marginTop: 14,
      paddingTop: 12,
      borderTop: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: 10,
    }}>
      <ActivityMetric
        label={t('points.detail.activityRange', { range: rangeLabel })}
        value={t('points.detail.activityTrades', { n: count })}
      />
      <ActivityMetric
        label={t('points.detail.activityVolumeRange', { range: rangeLabel })}
        value={`${formatCompactMxnp(volume, locale)} MXNP`}
      />
      <ActivityMetric
        label={t('points.detail.activityPressure')}
        value={pressureLabel}
        tone={buyShare != null && buyShare >= 55 ? 'buy' : sellShare != null && sellShare >= 55 ? 'sell' : 'neutral'}
      />
      <ActivityMetric
        label={t('points.detail.activityLast')}
        value={formatActivityAge(latestTradeAt, t)}
      />
    </div>
  );
}

function ActivityMetric({ label, value, tone = 'neutral' }) {
  const color = tone === 'buy' ? 'var(--green)' : tone === 'sell' ? '#ff3b3b' : 'var(--text-primary)';
  return (
    <div style={{
      minWidth: 0,
      padding: '9px 10px',
      borderRadius: 10,
      background: 'var(--surface2)',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 4,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
    </div>
  );
}

const MULTI_ACCENTS = [
  { border: 'rgba(63,174,114,0.25)', bg: 'rgba(63,174,114,0.08)',  fg: '#3FAE72' },
  { border: 'rgba(217,166,60,0.3)',  bg: 'rgba(217,166,60,0.08)',  fg: '#D9A63C' },
  { border: 'rgba(226,87,79,0.25)',  bg: 'rgba(226,87,79,0.08)',   fg: '#E2574F' },
  { border: 'rgba(93,142,224,0.3)',  bg: 'rgba(93,142,224,0.08)',  fg: '#5D8EE0' },
  { border: 'rgba(164,127,209,0.3)', bg: 'rgba(164,127,209,0.08)', fg: '#A47FD1' },
  { border: 'rgba(76,179,194,0.3)',  bg: 'rgba(76,179,194,0.08)',  fg: '#4CB3C2' },
  { border: 'rgba(214,135,168,0.3)', bg: 'rgba(214,135,168,0.08)', fg: '#D687A8' },
  { border: 'rgba(156,184,78,0.3)',  bg: 'rgba(156,184,78,0.08)',  fg: '#9CB84E' },
];

function accentFor(i, totalOutcomes) {
  // Binary keeps the canonical green (YES) / red (NO) colors.
  if (totalOutcomes === 2) return i === 0 ? MULTI_ACCENTS[0] : MULTI_ACCENTS[2];
  return MULTI_ACCENTS[i % MULTI_ACCENTS.length];
}

function clampProbability(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function parallelLegYesPrice(leg, fallback = 0.5) {
  if (String(leg?.status || '') === 'resolved') {
    const resolvedOutcome = Number(leg?.outcome);
    if (resolvedOutcome === 0) return 1;
    if (resolvedOutcome === 1) return 0;
    return 0;
  }
  if (leg?.status && leg.status !== 'active') return 0;
  return clampProbability(leg?.prices?.[0], fallback);
}

function parallelLegNoPrice(leg, fallback = 0.5) {
  if (String(leg?.status || '') === 'resolved') {
    const resolvedOutcome = Number(leg?.outcome);
    if (resolvedOutcome === 0) return 0;
    if (resolvedOutcome === 1) return 1;
    return 1;
  }
  const explicitNo = Array.isArray(leg?.prices) ? leg.prices[1] : null;
  if (explicitNo != null) return clampProbability(explicitNo, 1 - fallback);
  return clampProbability(1 - parallelLegYesPrice(leg, fallback), 1 - fallback);
}

function parallelLegIsTradable(leg, market) {
  return market?.status === 'active'
    && (leg?.status ?? market?.status) === 'active'
    && !market?.seriesLocked
    && !leg?.seriesLocked;
}

function sortParallelDisplayLegs(legs) {
  return (Array.isArray(legs) ? legs : [])
    .map((leg, index) => ({
      ...leg,
      outcomeIndex: Number.isInteger(Number(leg?.outcomeIndex)) ? Number(leg.outcomeIndex) : index,
      originalOrder: index,
    }))
    .sort((a, b) => {
      const aOpen = a.status === 'active' ? 0 : 1;
      const bOpen = b.status === 'active' ? 0 : 1;
      return aOpen - bOpen
        || parallelLegYesPrice(b) - parallelLegYesPrice(a)
        || a.originalOrder - b.originalOrder;
    });
}

function chartActivityScore(activity) {
  if (!Array.isArray(activity) || activity.length === 0) return 0;
  return activity.reduce((score, pt) => {
    const count = Number(pt?.count || 0);
    const volume = Number(pt?.volume || 0);
    const t = Number(pt?.t || 0);
    return score
      + (Number.isFinite(count) ? count : 0)
      + (Number.isFinite(volume) ? volume / 100 : 0)
      + (Number.isFinite(t) ? t / 1e12 : 0);
  }, 0);
}

function chartOutcomeIndicesForDisplay({
  displayOutcomes = [],
  displayPrices = [],
  displayActivityByOutcome = [],
  parallelDisplayLegs = null,
}) {
  const all = displayOutcomes.map((_, i) => i);
  if (all.length <= 4) return all;

  const ranked = [...all].sort((a, b) =>
    (displayPrices[b] ?? 0) - (displayPrices[a] ?? 0) || a - b,
  );
  const activeMovers = [...all]
    .filter(i => chartActivityScore(displayActivityByOutcome?.[i]) > 0)
    .sort((a, b) =>
      chartActivityScore(displayActivityByOutcome?.[b]) - chartActivityScore(displayActivityByOutcome?.[a])
      || (displayPrices[b] ?? 0) - (displayPrices[a] ?? 0)
      || a - b,
    );

  const selected = [];
  const add = (i) => {
    if (Number.isInteger(i) && i >= 0 && i < all.length && !selected.includes(i)) {
      selected.push(i);
    }
  };

  for (const i of ranked.slice(0, 4)) add(i);
  for (const i of activeMovers.slice(0, 2)) add(i);
  if (!Array.isArray(parallelDisplayLegs)) return selected.slice(0, 6);

  const liveSelected = selected
    .filter(i => parallelDisplayLegs[i]?.status === 'active')
    .slice(0, 6);
  selected.length = 0;
  liveSelected.forEach(add);

  for (const i of ranked) {
    if (selected.length >= 4) break;
    if (!selected.includes(i)) selected.push(i);
  }
  for (const i of activeMovers) {
    if (selected.length >= 6) break;
    add(i);
  }

  const zeroed = all
    .filter(i => String(parallelDisplayLegs[i]?.status || '') === 'resolved'
      && Number(parallelDisplayLegs[i]?.outcome) === 1)
    .slice(0, 2);
  for (const i of zeroed) {
    if (!selected.includes(i)) selected.push(i);
  }

  return selected.slice(0, 6);
}

// True binary markets ("Sí"/"No", "Yes"/"No") collapse to one line since
// No is just Sí's mirror. Two named rivals — candidates, teams, two
// different answers — carry real information in both lines, so those
// get the shared-axis two-line chart instead.
function isBinaryYesNoOutcomes(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length !== 2) return false;
  const [a, b] = outcomes.map(o => String(o || '').trim().toLowerCase());
  return (a === 'sí' || a === 'si' || a === 'yes') && b === 'no';
}

// Same green/red-for-binary rule as accentFor, so a two-rival chart
// line matches the color of its buy button below.
function chartColorFor(i, totalOutcomes) {
  if (totalOutcomes === 2) return i === 0 ? OUTCOME_COLORS[0] : OUTCOME_COLORS[2];
  return OUTCOME_COLORS[i % OUTCOME_COLORS.length];
}

// Map (resolver_type, resolver_config.source) → human-readable source
// name. Brand names stay untranslated — "Chainlink" is "Chainlink" in
// every language.
const RESOLVER_LABELS = {
  'chainlink_price':               'Chainlink',
  'weather_api':                   'Open-Meteo',
  'api_price:finnhub':             'Finnhub',
  'api_price:banxico-fix':         'Banxico',
  'api_price:cre-gasolina':        'CRE',
  'api_chart:apple-mx-songs':      'Apple Music',
  'api_chart:youtube-trending-mx': 'YouTube',
  'api_transcript:gob-mx-presidencia-transcript': 'gob.mx / YouTube oficial',
  'sports_api:espn':               'ESPN',
  'sports_api:football-data':      'football-data.org',
  'sports_api:jolpica-f1':         'Jolpica F1',
};

function resolverLabel(type, source) {
  if (!type) return null; // null = admin-manual; surface as 'Admin' via fallback text
  const composite = source ? `${type}:${source}` : type;
  return RESOLVER_LABELS[composite] || RESOLVER_LABELS[type] || type;
}

function timestampReasonLabel(reason) {
  const key = String(reason || '').trim();
  if (key === 'youtube_captions_not_found') return 'YouTube no entregó captions públicos con tiempo.';
  if (key === 'official_youtube_video_not_found') return 'No encontramos el video oficial con captions públicos.';
  if (key === 'timed_caption_segments_not_found') return 'La fuente disponible no trae segmentos con tiempo.';
  if (key === 'phrase_timestamp_not_found') return 'La frase apareció en el texto, pero no pudimos ubicar su timestamp.';
  return key ? `Timestamps no disponibles: ${key}.` : 'Timestamps no disponibles.';
}

function hasTranscriptEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  return Number.isFinite(Number(evidence.matchCount))
    || (Array.isArray(evidence.timestamps) && evidence.timestamps.length > 0)
    || (Array.isArray(evidence.positions) && evidence.positions.length > 0);
}

function formatTranscriptPosition(position, locale = 'es-MX') {
  const charIndex = Number(position?.charIndex);
  const totalChars = Number(position?.totalChars);
  if (!Number.isFinite(charIndex)) return null;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const parts = [`caracter ${nf.format(Math.max(0, Math.floor(charIndex)))}`];
  if (Number.isFinite(totalChars) && totalChars > 0) {
    parts.push(`de ${nf.format(Math.floor(totalChars))}`);
  }
  if (Number.isFinite(Number(position?.percent))) {
    parts.push(`${Number(position.percent).toFixed(1)}%`);
  }
  return parts.join(' ');
}

function TranscriptEvidencePanel({ evidence, isAdmin, locale }) {
  if (!isAdmin || !hasTranscriptEvidence(evidence)) return null;
  const timestamps = Array.isArray(evidence.timestamps) ? evidence.timestamps : [];
  const positions = Array.isArray(evidence.positions) ? evidence.positions : [];
  const matchCount = Number(evidence.matchCount);
  const threshold = Number(evidence.threshold);
  const countLabel = Number.isFinite(matchCount)
    ? `${matchCount} menciones${Number.isFinite(threshold) ? ` / meta ${threshold}` : ''}`
    : null;

  return (
    <div style={{
      marginBottom: 24,
      padding: '14px 16px',
      borderRadius: 12,
      background: 'rgba(255, 91, 0, 0.07)',
      border: '1px solid rgba(255, 91, 0, 0.28)',
      maxWidth: 980,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--orange)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        Evidencia del resolver
      </div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginBottom: timestamps.length || positions.length ? 10 : 0,
      }}>
        {evidence.phrase && <span>Frase: "{evidence.phrase}"</span>}
        {countLabel && <span>{countLabel}</span>}
        {evidence.transcriptUrl && (
          <a
            href={evidence.transcriptUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--orange)', textDecoration: 'none' }}
          >
            Fuente
          </a>
        )}
      </div>
      {timestamps.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {timestamps.map((item, idx) => {
            const label = item.label || `${item.seconds}s`;
            const chipStyle = {
              display: 'inline-flex',
              alignItems: 'center',
              padding: '7px 10px',
              borderRadius: 999,
              border: '1px solid rgba(0, 208, 121, 0.34)',
              background: 'rgba(0, 208, 121, 0.08)',
              color: 'var(--green)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              textDecoration: 'none',
            };
            return item.url ? (
              <a key={`${label}-${idx}`} href={item.url} target="_blank" rel="noreferrer" style={chipStyle}>
                {label}
              </a>
            ) : (
              <span key={`${label}-${idx}`} style={chipStyle}>{label}</span>
            );
          })}
        </div>
      ) : positions.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}>
            {timestampReasonLabel(evidence.timestampEvidenceUnavailableReason)}
          </div>
          {positions.map((position, idx) => {
            const label = formatTranscriptPosition(position, locale) || `mención ${idx + 1}`;
            return (
              <div key={`${position.charIndex}-${idx}`} style={{
                padding: '9px 10px',
                borderRadius: 10,
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}>
                <div style={{ color: 'var(--orange)', marginBottom: position.snippet ? 4 : 0 }}>
                  {label}
                </div>
                {position.snippet && <div>{position.snippet}</div>}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function optionText(option) {
  if (option == null) return '';
  if (typeof option === 'string' || typeof option === 'number') return String(option);
  return String(option.label || option.name || option.title || option.value || '');
}

function isTemperatureMarket(market) {
  if (!market) return false;
  const optionLabels = Array.isArray(market.outcomes)
    ? market.outcomes.map(optionText)
    : Array.isArray(market.options)
      ? market.options.map(optionText)
      : [];
  const topicTags = Array.isArray(market.topicTags) ? market.topicTags : [];
  const haystack = [
    market.title,
    market.question,
    market.category,
    market.resolverType,
    market.resolverSource,
    ...topicTags,
    ...optionLabels,
  ].filter(Boolean).join(' ').toLowerCase();
  return /temperatura|temperature|celsius|°c/.test(haystack);
}

// ─── Outcome pickers ────────────────────────────────────────────────────────
// Unified: one tap-target per outcome ("Sí" / "No" / "Barcelona" …) showing
// the current percentage. Tapping opens the buy modal for that outcome at
// the shared pool.
//
// Layout: when the generator supplied a logo for this outcome, it sits
// on the LEFT outside the "pill" (the pill contains only the price).
// This matches the card layout and gives crests/logos room to breathe.
//
// Scroll: when a market has > SCROLL_AT_N outcomes (F1 has 21), the list
// is wrapped in a fixed-height scroll container by the caller, so the
// detail page doesn't turn into an endless vertical stack.
const SCROLL_AT_N = 6;
const DISPLAYABLE_SHARE_EPSILON = 0.005;

function outcomeInitials(label) {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] || '?';
  const second = words.length > 1 ? words[words.length - 1]?.[0] : '';
  return `${first}${second}`.toUpperCase();
}

function OutcomeLogo({ src, label, size = 28 }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'inline-grid',
          placeItems: 'center',
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: Math.max(9, Math.round(size * 0.36)),
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {outcomeInitials(label)}
      </span>
    );
  }
  return (
    <img
      src={pointsPublicAssetSrc(src)}
      alt=""
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
      }}
      onError={() => setFailed(true)}
    />
  );
}

function CountryChip({ label }) {
  if (!label) return null;
  return (
    <span style={{
      maxWidth: 96,
      padding: '3px 7px',
      borderRadius: 999,
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function ScrollableList({ count, children }) {
  if (count <= SCROLL_AT_N) return <>{children}</>;
  return (
    <div style={{
      maxHeight: 360,
      overflowY: 'auto',
      paddingRight: 4,
      // Subtle scroll shadow so users see there's more below.
      WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)',
      maskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)',
    }}>
      {children}
    </div>
  );
}

function UnifiedOutcomeList({
  outcomes,
  prices,
  outcomeImages,
  outcomeCountryLabels,
  outcomeIndices,
  market,
  onBuyClick,
  onParlayAdd,
  selectionMode = 'single',
}) {
  const isCombinadaMode = selectionMode === 'combo';
  return (
    <ScrollableList count={outcomes.length}>
      {outcomes.map((label, i) => {
        const pct = Math.round((prices[i] ?? 0) * 100);
        const accent = accentFor(i, outcomes.length);
        const logo = outcomeImages?.[i] || null;
        const countryLabel = outcomeCountryLabels?.[i] || null;
        const originalIndex = Array.isArray(outcomeIndices) ? outcomeIndices[i] : i;
        const addLeg = () => onParlayAdd?.({
          market,
          outcomeIndex: originalIndex,
          outcomeLabel: label,
          price: prices[i],
        });
        return (
          <div
            key={i}
            style={{
              width: '100%',
              padding: '6px',
              marginBottom: 8,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = accent.border;
              e.currentTarget.style.background = 'var(--surface1)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.background = 'var(--surface2)';
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (isCombinadaMode) addLeg();
                else onBuyClick(market, originalIndex, label);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                padding: '4px 0 4px 4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <OutcomeLogo src={logo} label={label} />
              <span style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {label}
              </span>
              <CountryChip label={countryLabel} />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                flexShrink: 0,
                color: accent.fg,
              }}>
                {pct}%
              </span>
            </button>
            {isCombinadaMode && (
              <button
                type="button"
                onClick={addLeg}
                style={parlayAddButtonStyle}
              >
                Agregar
              </button>
            )}
          </div>
        );
      })}
    </ScrollableList>
  );
}

// Parallel: each row is a binary Sí/No market. Rendered Polymarket-style:
// label + aggregated %, then compact Sí / No buttons with each side's
// current price. Clicking either opens the buy modal against the leg.
//
// Leg images are passed in display order. The parent stores one image
// per original outcome; the caller sorts those alongside the legs.
function ParallelLegList({ market, legs, outcomeImages, outcomeCountryLabels, onBuyClick, onParlayAdd, selectionMode = 'single' }) {
  const isCombinadaMode = selectionMode === 'combo';
  return (
    <ScrollableList count={legs.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {legs.map((leg, i) => {
          const accent = accentFor(i, legs.length);
          const yesPrice = parallelLegYesPrice(leg);
          const noPrice  = parallelLegNoPrice(leg);
          const pct = Math.round(yesPrice * 100);
          const logo = outcomeImages?.[i] || null;
          const countryLabel = outcomeCountryLabels?.[i] || null;
          const isLegTradable = parallelLegIsTradable(leg, market);
          const closedLabel = leg.status === 'resolved'
            ? (Number(leg.outcome) === 0 ? 'Sí · 100%' : 'No · 0%')
            : 'Cerrado';
          // Carry the leg's own gating fields through — handleBuyClick
          // checks status/seriesLocked on whatever target it gets, so a
          // synthetic leg market missing them reads as "not active" and
          // the buy click is silently swallowed.
          const legMarket = {
            id: leg.id,
            parentId: market.id,
            groupId: market.id,
            question: `${market.question} — ${leg.label}`,
            status: leg.status ?? market.status,
            seriesLocked: leg.seriesLocked ?? market.seriesLocked,
          };
          return (
            <div
              key={leg.id}
              style={{
                // Flex with wrap so long leg labels (golfer names,
                // driver names) get the full row width they need and
                // the Sí/No buttons drop to a second line cleanly
                // instead of colliding into the name column.
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${isLegTradable ? 'var(--border)' : 'rgba(255,255,255,0.06)'}`,
                background: 'var(--surface2)',
                opacity: isLegTradable ? 1 : 0.58,
              }}
            >
              <OutcomeLogo src={logo} label={leg.label} />
              <div style={{
                flex: '1 1 200px',
                minWidth: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600,
                color: isLegTradable ? 'var(--text-primary)' : 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {leg.label}
              </div>
              <CountryChip label={countryLabel} />
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                color: isLegTradable ? accent.fg : 'var(--text-muted)',
                minWidth: 48,
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {pct}%
              </div>
              {isLegTradable ? (
                <div style={{
                  display: 'flex',
                  gap: 6,
                  flexShrink: 0,
                  // Push the buttons to the right edge when the row
                  // has enough width; wrap to a new line below the
                  // label when there's not.
                  marginLeft: 'auto',
                }}>
                  {!isCombinadaMode && (
                    <>
                      <button
                        onClick={() => onBuyClick(legMarket, 0, `${leg.label} — Sí`)}
                        type="button"
                        style={legButtonStyle('var(--yes)', 'rgba(22,163,74,0.15)', 'rgba(22,163,74,0.4)')}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                      >
                        Sí <span style={legPriceStyle}>{Math.round(yesPrice * 100)}¢</span>
                      </button>
                      <button
                        onClick={() => onBuyClick(legMarket, 1, `${leg.label} — No`)}
                        type="button"
                        style={legButtonStyle('var(--danger)', 'rgba(255,59,59,0.12)', 'rgba(255,59,59,0.4)')}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                      >
                        No <span style={legPriceStyle}>{Math.round(noPrice * 100)}¢</span>
                      </button>
                    </>
                  )}
                  {isCombinadaMode && (
                    <>
                      <button
                        type="button"
                        onClick={() => onParlayAdd?.({
                          market: legMarket,
                          outcomeIndex: 0,
                          outcomeLabel: `${leg.label} — Sí`,
                          price: yesPrice,
                        })}
                        style={parlayAddButtonStyle}
                      >
                        + Sí
                      </button>
                      <button
                        type="button"
                        onClick={() => onParlayAdd?.({
                          market: legMarket,
                          outcomeIndex: 1,
                          outcomeLabel: `${leg.label} — No`,
                          price: noPrice,
                        })}
                        style={parlayAddButtonStyle}
                      >
                        + No
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div style={{
                  marginLeft: 'auto',
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {closedLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollableList>
  );
}

// Read-only price summary used for the lower "Odds actuales" block.
// Each row: label on the left (swatch in the outcome's accent), % on the
// right. No buttons — the actual buying happens in the right sidebar.
function OddsSummary({ outcomes, prices, outcomeImages, outcomeCountryLabels }) {
  return (
    <ScrollableList count={outcomes.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {outcomes.map((label, i) => {
          const accent = accentFor(i, outcomes.length);
          const pct = Math.round((prices[i] ?? 0) * 100);
          const logo = outcomeImages?.[i] || null;
          const countryLabel = outcomeCountryLabels?.[i] || null;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
              }}
            >
              {logo ? (
                <OutcomeLogo src={logo} label={label} />
              ) : (
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: accent.fg,
                  flexShrink: 0,
                }} />
              )}
              <span style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {label}
              </span>
              <CountryChip label={countryLabel} />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                color: accent.fg,
                minWidth: 38,
                textAlign: 'right',
              }}>
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </ScrollableList>
  );
}

const parlayAddButtonStyle = {
  minHeight: 30,
  padding: '0 9px',
  borderRadius: 8,
  border: '1px solid rgba(255,85,0,0.35)',
  background: 'rgba(255,85,0,0.08)',
  color: 'var(--orange)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

function legButtonStyle(fg, bg, border) {
  return {
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: bg,
    color: fg,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    display: 'inline-flex',
    gap: 6,
    alignItems: 'center',
    transition: 'transform 0.15s, border-color 0.15s, background 0.15s',
    whiteSpace: 'nowrap',
  };
}
const legPriceStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 12,
  opacity: 0.9,
};

function formatDeadline(endTime) {
  if (!endTime) return '';
  const d = new Date(endTime);
  return d.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortGameDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function seriesGameStatus(item, t) {
  if (item?.status === 'not_needed') return t('points.series.notNeeded');
  if (item?.status === 'resolved') return t('points.series.final');
  if (item?.placeholder || item?.status === 'pending' || item?.seriesLocked) return t('points.series.pending');
  const now = Date.now();
  const start = item?.startTime ? new Date(item.startTime).getTime() : NaN;
  const end = item?.endTime ? new Date(item.endTime).getTime() : NaN;
  if (item?.status === 'active' && Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now) {
    return t('points.card.live');
  }
  if (item?.status === 'active' && Number.isFinite(end) && end < now) {
    return t('points.detail.statePending');
  }
  return t('points.series.open');
}

function SeriesGameStrip({ seriesMeta, currentMarketId, navigate, t }) {
  const sequence = Array.isArray(seriesMeta?.sequence) ? seriesMeta.sequence : [];
  if (sequence.length <= 1) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {seriesMeta.round || t('points.series.label')}
        </span>
        {formatSeriesScoreSummary(seriesMeta, { t }) && (
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            {formatSeriesScoreSummary(seriesMeta, { t })}
          </span>
        )}
      </div>
      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 2,
      }}>
        {sequence.map((item) => {
          const isCurrent = Number(item.id) === Number(currentMarketId);
          const clickable = item.id && !isCurrent && !item.seriesLocked && item.status !== 'pending' && item.status !== 'not_needed';
          const status = seriesGameStatus(item, t);
          const muted = item.placeholder || item.seriesLocked || item.status === 'not_needed';
          return (
            <button
              key={`${item.gameNumber}-${item.id || item.status}`}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (clickable) navigate(`/market?id=${encodeURIComponent(item.id)}`);
              }}
              title={item.subtitle || formatSeriesGameLabel(item.gameNumber, { t })}
              style={{
                minWidth: 122,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${isCurrent ? 'rgba(0,232,122,0.45)' : 'var(--border)'}`,
                background: isCurrent ? 'rgba(0,232,122,0.10)' : 'var(--surface1)',
                opacity: muted ? 0.62 : 1,
                cursor: clickable ? 'pointer' : 'default',
                textAlign: 'left',
                flex: '0 0 auto',
              }}
            >
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                color: isCurrent ? 'var(--green)' : 'var(--text-primary)',
                marginBottom: 4,
              }}>
                {formatSeriesGameLabel(item.gameNumber, { t })}
              </span>
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: item.status === 'resolved' ? 'var(--green)'
                  : item.status === 'not_needed' ? 'var(--text-muted)'
                  : item.placeholder || item.seriesLocked || item.status === 'pending' ? 'var(--warning)'
                  : 'var(--text-secondary)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 4,
                whiteSpace: 'nowrap',
              }}>
                {status}
              </span>
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
              }}>
                {item.startTime ? shortGameDate(item.startTime) : t('points.series.datePending')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Ring chart — same shape as MVP's ProbabilityChart, minus on-chain state */
function ProbabilityRing({ pct, resolved, winner, label, logo, color = 'var(--yes)' }) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
  const dash = (safePct / 100) * circ;
  const ringColor = resolved ? (winner ? 'var(--yes)' : 'var(--danger)') : color;

  return (
    <div
      aria-label={`${label} ${safePct}%`}
      style={{
        position: 'relative',
        width: 140,
        height: 140,
        flexShrink: 0,
      }}
    >
      <svg width={140} height={140} viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface2)" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dasharray 0.5s' }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        inset: 24,
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        gap: 5,
      }}>
        {logo ? (
          <OutcomeLogo src={logo} label={label} size={44} />
        ) : (
          <span style={{
            width: 44,
            height: 44,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface2)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 17,
          }}>
            {outcomeInitials(label)}
          </span>
        )}
        <span style={{
          color: winner ? 'var(--green)' : 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          lineHeight: 1,
        }}>
          {safePct}%
        </span>
        {resolved && winner && (
          <span style={{
            color: 'var(--green)',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Ganador
          </span>
        )}
      </div>
    </div>
  );
}

function ProbabilityGaugeRow({ outcomes, outcomeImages, pctFor, isResolved, winnerIndex }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12,
      marginBottom: 32,
    }}>
      {outcomes.map((label, i) => {
        const isWinner = isResolved && winnerIndex === i;
        const accent = accentFor(i, outcomes.length);
        return (
          <div
            key={label}
            style={{
              display: 'grid',
              justifyItems: 'center',
              gap: 8,
              padding: '16px 12px',
              border: `1px solid ${isWinner ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              borderRadius: 12,
              background: isWinner ? 'rgba(0,232,122,0.08)' : 'var(--surface1)',
              opacity: isResolved && !isWinner ? 0.58 : 1,
            }}
          >
            <ProbabilityRing
              pct={pctFor(i)}
              resolved={isResolved}
              winner={isWinner}
              label={label}
              logo={outcomeImages?.[i] || null}
              color={accent.fg}
            />
            <div style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: isWinner ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDepthCents(price) {
  if (!Number.isFinite(Number(price))) return '--';
  const cents = Math.max(0, Math.min(100, Number(price) * 100));
  return `${cents.toFixed(cents >= 10 ? 1 : 2)}¢`;
}

function formatDepthAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  if (n >= 1000) return n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
  if (n >= 100) return n.toLocaleString('es-MX', { maximumFractionDigits: 1 });
  return n.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function formatLimitInputPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return '';
  const cents = n > 1 ? n : n * 100;
  if (cents >= 10) return cents.toFixed(1).replace(/\.0$/, '');
  return cents.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

function parseLimitInputPrice(value) {
  const n = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const price = n > 1 ? n / 100 : n;
  if (price <= 0 || price >= 1) return null;
  return price;
}

function buildOrderBookOptions({ market, displayOutcomes, displayOutcomeIndices, displayOutcomeImages, parallelDisplayLegs }) {
  if (!market) return [];
  if (market.ammMode === 'parallel' && Array.isArray(market.legs)) {
    const legs = Array.isArray(parallelDisplayLegs)
      ? parallelDisplayLegs
      : sortParallelDisplayLegs(market.legs);
    return legs
      .filter(leg => parallelLegIsTradable(leg, market))
      .map((leg, i) => ({
        key: `${leg.id}:0`,
        marketId: leg.id,
        outcomeIndex: 0,
        label: leg.label || displayOutcomes[i] || `Opción ${i + 1}`,
        logo: displayOutcomeImages?.[i] || null,
        price: parallelLegYesPrice(leg),
      }));
  }
  return displayOutcomes.map((label, i) => ({
    key: `${market.id}:${displayOutcomeIndices[i] ?? i}`,
    marketId: market.id,
    outcomeIndex: displayOutcomeIndices[i] ?? i,
    label,
    logo: displayOutcomeImages?.[i] || null,
    price: Array.isArray(market.prices) ? market.prices[displayOutcomeIndices[i] ?? i] : null,
  }));
}

function tradeTapeIdsForMarket(market) {
  if (!market?.id) return [];
  if (market.ammMode === 'parallel' && Array.isArray(market.legs)) {
    return [
      Number(market.id),
      ...market.legs
        .map(leg => Number(leg?.id))
        .filter(id => Number.isInteger(id) && id > 0),
    ];
  }
  return [Number(market.id)];
}

function DepthRows({ rows, side, maxTotal, t, onPickRow, showSource = false }) {
  const accent = side === 'ask' ? 'var(--danger)' : 'var(--yes)';
  const bg = side === 'ask' ? 'rgba(255,59,59,0.10)' : 'rgba(0,232,122,0.10)';
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div style={{
        padding: '12px 10px',
        border: '1px dashed var(--border)',
        borderRadius: 10,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
      }}>
        {t('points.detail.orderBookEmpty')}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((row, i) => {
        const width = maxTotal > 0
          ? `${Math.max(5, Math.min(100, (Number(row.total) / maxTotal) * 100))}%`
          : '0%';
        return (
          <button
            key={`${side}-${row.price}-${row.shares}-${i}`}
            type="button"
            onClick={() => onPickRow?.(row, side)}
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: '72px 1fr 74px',
              alignItems: 'center',
              gap: 10,
              minHeight: 30,
              padding: '7px 10px',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'var(--surface2)',
              border: '1px solid rgba(255,255,255,0.03)',
              cursor: onPickRow ? 'pointer' : 'default',
              color: 'inherit',
              textAlign: 'inherit',
            }}
          >
            <span style={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width,
              background: bg,
              pointerEvents: 'none',
            }} />
            <span style={{ position: 'relative', zIndex: 1, color: accent, fontFamily: 'var(--font-display)', fontSize: 15 }}>
              {formatDepthCents(row.price)}
            </span>
            <span style={{
              position: 'relative',
              zIndex: 1,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textAlign: 'right',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}>
              <span>{formatDepthAmount(row.shares)}</span>
              {showSource && (
                <span style={{
                  fontSize: 8,
                  color: row.source === 'limit' || row.source === 'maker' ? 'var(--orange)' : 'var(--text-muted)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}>
                  {row.source === 'limit'
                    ? t('points.detail.orderBookSourceUsers')
                    : row.source === 'maker'
                      ? t('points.detail.orderBookSourceMaker')
                      : t('points.detail.orderBookSourceAmm')}
                </span>
              )}
            </span>
            <span style={{
              position: 'relative',
              zIndex: 1,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textAlign: 'right',
            }}>
              {formatDepthAmount(row.total)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DepthRowsSkeleton({ side }) {
  const bg = side === 'ask' ? 'rgba(255,59,59,0.08)' : 'rgba(0,232,122,0.08)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`${side}-skeleton-${i}`}
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: '72px 1fr 74px',
            alignItems: 'center',
            gap: 10,
            minHeight: 30,
            padding: '7px 10px',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--surface2)',
            border: '1px solid rgba(255,255,255,0.03)',
          }}
        >
          <span style={{
            position: 'absolute',
            inset: '0 auto 0 0',
            width: `${78 - i * 12}%`,
            background: bg,
            opacity: 0.75,
          }} />
          {[0, 1, 2].map((slot) => (
            <span key={slot} style={{
              position: 'relative',
              zIndex: 1,
              justifySelf: slot === 0 ? 'start' : 'end',
              width: slot === 0 ? 42 : slot === 1 ? 56 : 62,
              height: 10,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.08)',
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function OrderBookPanel({
  market,
  displayOutcomes,
  displayOutcomeIndices,
  displayOutcomeImages,
  parallelDisplayLegs,
  disabled,
  authenticated,
  onOpenLogin,
  onOrderChange,
  refreshKey,
}) {
  const t = useT();
  const lang = useLang();
  const numberLocale = lang === 'en' ? 'en-US' : 'es-MX';
  const [selected, setSelected] = useState(0);
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [orderSide, setOrderSide] = useState('buy');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderAmount, setOrderAmount] = useState('');
  const [userOrders, setUserOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderError, setOrderError] = useState(null);
  const [orderMessage, setOrderMessage] = useState(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const bookCacheRef = useRef(new Map());
  const options = buildOrderBookOptions({
    market,
    displayOutcomes,
    displayOutcomeIndices,
    displayOutcomeImages,
    parallelDisplayLegs,
  });
  const optionsSig = options.map((option) => option.key).join('|');
  const safeSelected = Math.min(selected, Math.max(0, options.length - 1));
  const selectedOption = options[safeSelected] || null;

  useEffect(() => {
    setSelected(0);
    setLimitPrice('');
    setOrderAmount('');
    bookCacheRef.current = new Map();
  }, [optionsSig]);

  useEffect(() => {
    bookCacheRef.current = new Map();
    setLocalRefresh(v => v + 1);
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedOption) return;
    setLimitPrice(formatLimitInputPrice(selectedOption.price));
    setOrderAmount('');
    setOrderError(null);
    setOrderMessage(null);
  }, [selectedOption?.key]);

  useEffect(() => {
    if (!selectedOption?.marketId || disabled) {
      setBook(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    const cached = bookCacheRef.current.get(selectedOption.key);
    if (cached) {
      setBook(cached);
      setLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }
    setBook(null);
    setLoading(true);
    setError(null);
    fetchOrderBook({
      marketId: selectedOption.marketId,
      outcomeIndex: selectedOption.outcomeIndex,
      levels: 8,
    })
      .then((payload) => {
        bookCacheRef.current.set(selectedOption.key, payload);
        if (!cancelled) setBook(payload);
      })
      .catch(() => {
        if (!cancelled) setError('orderbook_failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedOption?.key, selectedOption?.marketId, selectedOption?.outcomeIndex, disabled, localRefresh]);

  useEffect(() => {
    if (!authenticated || !selectedOption?.marketId || disabled) {
      setUserOrders([]);
      setOrdersLoading(false);
      return undefined;
    }
    let cancelled = false;
    setOrdersLoading(true);
    fetchMyLimitOrders({ marketId: selectedOption.marketId })
      .then((payload) => {
        if (cancelled) return;
        const orders = Array.isArray(payload?.orders) ? payload.orders : [];
        setUserOrders(orders.filter(order => Number(order.outcomeIndex) === Number(selectedOption.outcomeIndex)));
      })
      .catch(() => {
        if (!cancelled) setUserOrders([]);
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });
    return () => { cancelled = true; };
  }, [authenticated, selectedOption?.key, selectedOption?.marketId, selectedOption?.outcomeIndex, disabled, localRefresh]);

  useEffect(() => {
    if (disabled || options.length <= 1) return undefined;
    let cancelled = false;
    const cleanup = [];
    const prefetchTargets = options
      .filter((option) => option.key !== selectedOption?.key && !bookCacheRef.current.has(option.key))
      .slice(0, 5);

    prefetchTargets.forEach((option, i) => {
      const run = () => {
        fetchOrderBook({
          marketId: option.marketId,
          outcomeIndex: option.outcomeIndex,
          levels: 8,
        })
          .then((payload) => {
            if (!cancelled) bookCacheRef.current.set(option.key, payload);
          })
          .catch(() => {});
      };
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const idleId = window.requestIdleCallback(run, { timeout: 700 + i * 120 });
        cleanup.push(() => window.cancelIdleCallback?.(idleId));
      } else if (typeof window !== 'undefined') {
        const timerId = window.setTimeout(run, 120 + i * 70);
        cleanup.push(() => window.clearTimeout(timerId));
      }
    });

    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, [optionsSig, selectedOption?.key, disabled]);

  if (!market || options.length === 0) return null;

  const asks = Array.isArray(book?.asks) ? book.asks : [];
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const maxTotal = [...asks, ...bids].reduce((max, row) => Math.max(max, Number(row.total) || 0), 0);
  const selectedOrders = userOrders.filter(order => Number(order.outcomeIndex) === Number(selectedOption?.outcomeIndex));

  function clearBookAndOrders() {
    if (selectedOption?.key) bookCacheRef.current.delete(selectedOption.key);
    setLocalRefresh(v => v + 1);
    onOrderChange?.();
  }

  function handlePickRow(row, side) {
    setOrderSide(side === 'ask' ? 'sell' : 'buy');
    setLimitPrice(formatLimitInputPrice(row.price));
    setOrderError(null);
    setOrderMessage(null);
  }

  async function handleLimitOrderSubmit(event) {
    event.preventDefault();
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    if (!selectedOption) return;
    const price = parseLimitInputPrice(limitPrice);
    const amount = Number(String(orderAmount || '').replace(',', '.'));
    if (!price) {
      setOrderError(publicErrorMessage('invalid_limit_price', lang, 'default'));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setOrderError(publicErrorMessage('invalid_amount', lang, 'default'));
      return;
    }

    setSubmittingOrder(true);
    setOrderError(null);
    setOrderMessage(null);
    try {
      const result = await placeLimitOrder({
        marketId: selectedOption.marketId,
        outcomeIndex: selectedOption.outcomeIndex,
        side: orderSide,
        limitPrice: price,
        amount,
      });
      const filled = result?.order?.status === 'filled' || result?.fill?.triggered;
      setOrderMessage(filled ? t('points.detail.limitOrderFilled') : t('points.detail.limitOrderSuccess'));
      setOrderAmount('');
      clearBookAndOrders();
    } catch (e) {
      setOrderError(publicErrorMessage(e, lang, 'limit_order_failed'));
    } finally {
      setSubmittingOrder(false);
    }
  }

  async function handleCancelOrder(orderId) {
    if (!orderId || cancellingOrderId) return;
    setCancellingOrderId(orderId);
    setOrderError(null);
    setOrderMessage(null);
    try {
      await cancelLimitOrder(orderId);
      setOrderMessage(t('points.detail.limitOrderCancelled'));
      clearBookAndOrders();
    } catch (e) {
      setOrderError(publicErrorMessage(e, lang, 'cancel_limit_order_failed'));
    } finally {
      setCancellingOrderId(null);
    }
  }

  return (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: 20,
      marginBottom: 24,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'baseline',
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            {t('points.detail.orderBook')}
          </div>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
          }}>
            {t('points.detail.orderBookHint')}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'grid', gap: 6, justifyItems: 'end' }}>
          <a
            href="/que-es-el-libro-de-ordenes"
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--orange)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Cómo funciona
          </a>
          {book?.spread != null && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {t('points.detail.orderBookSpread')}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text-primary)' }}>
                {formatDepthCents(book.spread)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 4,
        marginBottom: 14,
      }}>
        {options.map((option, i) => {
          const active = i === safeSelected;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setSelected(i)}
              style={{
                minWidth: 92,
                maxWidth: 148,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 999,
                border: `1px solid ${active ? 'rgba(255,85,0,0.55)' : 'var(--border)'}`,
                background: active ? 'rgba(255,85,0,0.12)' : 'var(--surface2)',
                color: active ? 'var(--orange)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <OutcomeLogo src={option.logo} label={option.label} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.label}</span>
            </button>
          );
        })}
      </div>

      {!disabled && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}>
          <form
            onSubmit={handleLimitOrderSubmit}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 12,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
              }}>
                {t('points.detail.limitOrderTitle')}
              </div>
              <div style={{
                display: 'inline-flex',
                padding: 2,
                border: '1px solid var(--border)',
                borderRadius: 999,
                background: 'var(--surface2)',
              }}>
                {[
                  ['buy', t('points.detail.limitOrderBuy')],
                  ['sell', t('points.detail.limitOrderSell')],
                ].map(([side, label]) => {
                  const active = orderSide === side;
                  return (
                    <button
                      key={side}
                      type="button"
                      onClick={() => {
                        setOrderSide(side);
                        setOrderError(null);
                        setOrderMessage(null);
                      }}
                      style={{
                        border: 'none',
                        borderRadius: 999,
                        padding: '6px 10px',
                        background: active
                          ? (side === 'buy' ? 'rgba(0,232,122,0.14)' : 'rgba(255,59,59,0.14)')
                          : 'transparent',
                        color: active
                          ? (side === 'buy' ? 'var(--yes)' : 'var(--danger)')
                          : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <p style={{
              margin: '0 0 10px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              lineHeight: 1.35,
            }}>
              {orderSide === 'buy'
                ? t('points.detail.limitOrderHintBuy')
                : t('points.detail.limitOrderHintSell')}
              {' '}
              {t('points.detail.limitOrderMakerReward')}
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 8,
            }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}>
                  {t('points.detail.limitOrderPrice')}
                </span>
                <input
                  value={limitPrice}
                  onChange={(event) => setLimitPrice(event.target.value)}
                  inputMode="decimal"
                  placeholder="72.5"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid var(--border)',
                    borderRadius: 9,
                    background: 'var(--surface2)',
                    color: 'var(--text-primary)',
                    padding: '10px 11px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}>
                  {orderSide === 'buy'
                    ? t('points.detail.limitOrderAmountBuy')
                    : t('points.detail.limitOrderAmountSell')}
                </span>
                <input
                  value={orderAmount}
                  onChange={(event) => setOrderAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder={orderSide === 'buy' ? '100' : '10'}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid var(--border)',
                    borderRadius: 9,
                    background: 'var(--surface2)',
                    color: 'var(--text-primary)',
                    padding: '10px 11px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={submittingOrder}
              style={{
                width: '100%',
                marginTop: 10,
                border: '1px solid rgba(255,85,0,0.45)',
                borderRadius: 10,
                padding: '10px 12px',
                background: submittingOrder ? 'rgba(255,85,0,0.12)' : 'var(--orange)',
                color: submittingOrder ? 'var(--orange)' : '#080808',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: submittingOrder ? 'default' : 'pointer',
              }}
            >
              {submittingOrder ? t('points.detail.limitOrderCreating') : t('points.detail.limitOrderCreate')}
            </button>
            {!authenticated && (
              <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                {t('points.detail.limitOrderLogin')}
              </p>
            )}
            {(orderError || orderMessage) && (
              <p style={{
                margin: '8px 0 0',
                color: orderError ? 'var(--danger)' : 'var(--yes)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                lineHeight: 1.45,
              }}>
                {orderError || orderMessage}
              </p>
            )}
          </form>

          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 12,
            background: 'rgba(255,255,255,0.02)',
            minHeight: 128,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              {t('points.detail.limitOrderOpenOrders')}
            </div>
            {!authenticated ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.5 }}>
                {t('points.detail.limitOrderLogin')}
              </p>
            ) : ordersLoading ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                {t('points.detail.orderBookLoading')}
              </p>
            ) : selectedOrders.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.5 }}>
                {t('points.detail.limitOrderNoOpenOrders')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {selectedOrders.map((order) => {
                  const liveReward = order.makerRewardEstimated ?? order.makerRewardAccrued ?? 0;
                  const makerReward = Number(liveReward || 0) + Number(order.makerRewardPaid || 0);
                  return (
                    <div
                      key={order.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 8,
                        alignItems: 'center',
                        padding: '8px 9px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: 9,
                        background: 'var(--surface2)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: order.side === 'buy' ? 'var(--yes)' : 'var(--danger)',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                        }}>
                          {order.side === 'buy' ? t('points.detail.limitOrderBuy') : t('points.detail.limitOrderSell')}
                          {' · '}
                          {formatDepthCents(order.limitPrice)}
                        </div>
                        <div style={{
                          marginTop: 3,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          color: 'var(--text-muted)',
                        }}>
                          {formatDepthAmount(order.remainingAmount)}
                          {' '}
                          {order.side === 'buy' ? 'MXNP' : t('points.detail.orderBookShares').toLowerCase()}
                        </div>
                        {makerReward > 0 && (
                          <div style={{
                            marginTop: 3,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9,
                            color: 'var(--orange)',
                          }}>
                            {t('points.detail.limitOrderRewardEarned')}
                            {': +'}
                            {formatDepthAmount(makerReward)}
                            {' MXNP'}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={cancellingOrderId === order.id}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '7px 9px',
                          background: 'transparent',
                          color: cancellingOrderId === order.id ? 'var(--text-muted)' : 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          cursor: cancellingOrderId === order.id ? 'default' : 'pointer',
                        }}
                      >
                        {cancellingOrderId === order.id
                          ? t('points.detail.limitOrderCancelling')
                          : t('points.detail.limitOrderCancel')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr 74px',
        gap: 10,
        padding: '0 10px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        <span>{t('points.detail.orderBookPrice')}</span>
        <span style={{ textAlign: 'right' }}>{t('points.detail.orderBookShares')}</span>
        <span style={{ textAlign: 'right' }}>{t('points.detail.orderBookTotal')}</span>
      </div>

      {disabled ? (
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {t('points.detail.orderBookUnavailable')}
        </p>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {t('points.detail.orderBookSellSide')}
            </div>
            <DepthRowsSkeleton side="ask" />
          </section>
          <section>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--yes)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {t('points.detail.orderBookBuySide')}
            </div>
            <DepthRowsSkeleton side="bid" />
          </section>
        </div>
      ) : error ? (
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>
          {t('points.detail.orderBookFailed')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {t('points.detail.orderBookSellSide')}
            </div>
            <DepthRows rows={asks} side="ask" maxTotal={maxTotal} t={t} onPickRow={handlePickRow} />
          </section>
          <section>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--yes)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {t('points.detail.orderBookBuySide')}
            </div>
            <DepthRows rows={bids} side="bid" maxTotal={maxTotal} t={t} onPickRow={handlePickRow} />
          </section>
        </div>
      )}

      {book?.lastPrice != null && !disabled && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          letterSpacing: '0.04em',
        }}>
          <span>{t('points.detail.orderBookLast')}: {formatDepthCents(book.lastPrice)}</span>
          <span>{t('points.detail.orderBookNow')}: {formatDepthCents(book.currentPrice)}</span>
        </div>
      )}
    </div>
  );
}

export default function PointsMarketDetail({ onOpenLogin, isAdmin = false }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const { authenticated, user, refresh } = usePointsAuth();
  const t = useT();
  const lang = useLang();
  const numberLocale = lang === 'en' ? 'en-US' : 'es-MX';
  // Collapses the 360px buy panel to a single column on phones so the
  // chart + outcome list can use the full viewport width.
  const isMobile = useIsMobile();

  const [market, setMarket] = useState(null);
  // historyByOutcome[i] = [{t, p}] for outcome i. Populated for every
  // outcome so the chart can render one line per option on multi markets.
  const [historyByOutcome, setHistoryByOutcome] = useState(null);
  const [activityByOutcome, setActivityByOutcome] = useState(null);
  const [chartRange, setChartRange] = useState('1');
  const chartRangeTouchedRef = useRef(false);
  const [userPositions, setUserPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // buyState.market is the effective trade target:
  //   unified → the parent market itself
  //   parallel → the individual leg market (so the buy endpoint hits the
  //              leg's binary CPMM, not the aggregated parent)
  const [buyState, setBuyState] = useState(null);
  const [tradeMode, setTradeMode] = useState('single');
  const [comboPickerOpen, setComboPickerOpen] = useState(false);
  const [parlaySlip, setParlaySlip] = useState(() => readStoredParlaySlip());
  const [parlayStake, setParlayStake] = useState('25');
  const [parlayState, setParlayState] = useState({
    loading: false,
    submitting: false,
    error: null,
    message: null,
    quote: null,
  });
  const [sellPreview, setSellPreview] = useState(null);
  const [tradeTape, setTradeTape] = useState([]);
  const [orderBookRefresh, setOrderBookRefresh] = useState(0);
  const [positionRefreshNonce, setPositionRefreshNonce] = useState(0);
  const [redeemState, setRedeemState] = useState({ key: null, message: null, error: null });
  const marketRefreshSigRef = useRef('');
  const sellQuoteSeqRef = useRef(0);
  const sellQuoteTimerRef = useRef(null);
  const cryptoSequenceSig = market?.cryptoMeta
    ? cryptoMarketSequenceSignature(buildCryptoMarketSequence(market))
    : '';
  const tradeTapeIds = useMemo(() => tradeTapeIdsForMarket(market), [market]);
  const tradeTapeIdsKey = tradeTapeIds.join(',');

  function applyFreshMarket(fresh) {
    if (!fresh) return;
    marketRefreshSigRef.current = marketLiveSignature(fresh);
    setMarket(fresh);
  }

  useEffect(() => () => {
    if (sellQuoteTimerRef.current) window.clearTimeout(sellQuoteTimerRef.current);
  }, []);

  useEffect(() => {
    storeParlaySlip(parlaySlip);
  }, [parlaySlip]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHistoryByOutcome(null);
    setActivityByOutcome(null);
    setTradeTape([]);
    chartRangeTouchedRef.current = false;
    fetchMarket(id)
      .then(m => {
        if (cancelled) return;
        applyFreshMarket(m);
        setLoading(false);
        if (!m) return;
      })
      .catch(() => { if (!cancelled) { setError('load_failed'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!market?.id) return undefined;

    if (!chartRangeTouchedRef.current) {
      const preferredRange = market.status === 'resolved' ? '30' : '1';
      if (chartRange !== preferredRange) {
        setChartRange(preferredRange);
        return undefined;
      }
    }

    let cancelled = false;
    const range = detailChartRangeFor(chartRange);

    const livePctFor = (outcomeIdx, leg = null) => {
      if (market.status === 'resolved') {
        return market.ammMode === 'parallel' && leg
          ? (Number(leg.outcome) === 0 ? 100 : 0)
          : (market.outcome != null && Number(market.outcome) === outcomeIdx ? 100 : 0);
      }
      if (market.status !== 'active') return null;
      const price = market.ammMode === 'parallel' && leg
        ? leg?.prices?.[0]
        : market.prices?.[outcomeIdx];
      const pct = Number(price) * 100;
      return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
    };
    const tailPointFor = (outcomeIdx, leg = null) => {
      const p = livePctFor(outcomeIdx, leg);
      if (p == null) return null;
      const t = market.status === 'resolved' && market.resolvedAt
        ? Math.floor(new Date(market.resolvedAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      return { t, p };
    };
    const withTail = (series, outcomeIdx, leg = null) => {
      const tail = tailPointFor(outcomeIdx, leg);
      if (!tail) return series;
      const filtered = series.filter(pt => pt.t <= tail.t);
      const last = filtered[filtered.length - 1];
      if (last && last.t === tail.t && Math.abs(last.p - tail.p) < 0.5) {
        return filtered;
      }
      return [...filtered, tail];
    };

    const load = async () => {
      if (market.ammMode === 'parallel' && Array.isArray(market.legs)) {
        const series = await Promise.all(
          market.legs.map((leg, i) =>
            fetchPriceHistory([leg.id], { days: range.days, hours: range.hours, outcome: 0, limit: range.limit })
              .then(h => withTail(h[leg.id] || [], i, leg))
              .catch(() => withTail([], i, leg)),
          ),
        );
        const activity = await Promise.all(
          market.legs.map((leg) =>
            fetchTradeActivity([leg.id], { days: range.days, hours: range.hours, outcome: 'all', buckets: range.buckets })
              .then(a => a[leg.id] || [])
              .catch(() => []),
          ),
        );
        if (!cancelled) {
          setHistoryByOutcome(series);
          setActivityByOutcome(activity);
        }
        return;
      }

      if (!Array.isArray(market.outcomes)) {
        if (!cancelled) {
          setHistoryByOutcome([]);
          setActivityByOutcome([]);
        }
        return;
      }

      const n = market.outcomes.length;
      const series = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          fetchPriceHistory([market.id], { days: range.days, hours: range.hours, outcome: i, limit: range.limit })
            .then(h => withTail(h[market.id] || [], i))
            .catch(() => withTail([], i)),
        ),
      );
      const activity = n <= 2
        ? [
            await fetchTradeActivity([market.id], { days: range.days, hours: range.hours, outcome: 'all', buckets: range.buckets })
              .then(a => a[market.id] || [])
              .catch(() => []),
            [],
          ]
        : await Promise.all(
            Array.from({ length: n }, (_, i) =>
              fetchTradeActivity([market.id], { days: range.days, hours: range.hours, outcome: i, buckets: range.buckets })
                .then(a => a[market.id] || [])
                .catch(() => []),
            ),
          );
      if (!cancelled) {
        setHistoryByOutcome(series);
        setActivityByOutcome(activity);
      }
    };

    load().catch(() => {
      if (!cancelled) {
        setHistoryByOutcome([]);
        setActivityByOutcome([]);
      }
    });

    return () => { cancelled = true; };
  }, [
    chartRange,
    market?.ammMode,
    market?.id,
    market?.outcome,
    market?.resolvedAt,
    market?.status,
    orderBookRefresh,
  ]);

  useEffect(() => {
    if (!market?.id || !tradeTapeIdsKey) {
      setTradeTape([]);
      return undefined;
    }
    let cancelled = false;
    fetchTradeTape(tradeTapeIds, { hours: 24 * 30, limit: 80, details: isAdmin })
      .then((tape) => {
        if (cancelled) return;
        const rows = tape?.[String(market.id)] || tape?.[market.id] || [];
        setTradeTape(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setTradeTape([]); });
    return () => { cancelled = true; };
  }, [market?.id, tradeTapeIds, tradeTapeIdsKey, orderBookRefresh, isAdmin]);

  useEffect(() => {
    if (!market?.id) return;
    trackInterest({
      ...marketInterestPayload('points', market, 'view'),
      objectType: 'points_market',
      action: 'view',
    });
  }, [market?.id]);

  // Light-touch polling keeps market pages alive while users are
  // watching them. Status/resolver changes matter, but so do normal
  // trade updates: another user's buy should move the price line,
  // orderbook, holders, and the signed-in user's mark-to-market values
  // without forcing a full page refresh.
  useEffect(() => {
    if (!id || !market) return undefined;
    const isCryptoMarket = Boolean(market.cryptoMeta);
    if (market.status === 'resolved' && !isCryptoMarket) return undefined;
    // 15s is right for real users but reads as a frozen page on camera, so
    // the video demo (/points/video) polls fast enough that the probability
    // visibly ticks. Guarded by the demo session flag — normal traffic keeps
    // the original cadence.
    const pollMs = videoDemoPollMs() ?? (isCryptoMarket ? 5_000 : 15_000);
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchMarket(id)
        .then(fresh => {
          if (!fresh) return;
          const nextSig = marketLiveSignature(fresh);
          if (nextSig && nextSig === marketRefreshSigRef.current) return;
          const didResolve = market.status !== 'resolved' && fresh.status === 'resolved';
          const statusChanged = market.status !== fresh.status || market.outcome !== fresh.outcome;
          applyFreshMarket(fresh);
          setOrderBookRefresh(v => v + 1);
          if (authenticated) setPositionRefreshNonce(v => v + 1);
          if (didResolve || statusChanged) {
            refresh?.();
            emitPointsRefresh({ source: didResolve ? 'resolved' : 'market_poll', marketId: fresh.id });
          }
        })
        .catch(() => { /* transient — next tick will retry */ });
    }, pollMs);
    return () => window.clearInterval(interval);
  }, [
    authenticated,
    id,
    market?.outcome,
    market?.status,
    market?.cryptoMeta?.nextMarketId,
    market?.cryptoMeta?.prevMarketId,
    market?.cryptoMeta?.threshold,
    cryptoSequenceSig,
    refresh,
  ]);

  // Fetch the signed-in user's positions. For parallel markets, positions
  // live on leg ids but positions.js surfaces the parent id via
  // `parentMarketId` — so we match on either to pick up both modes.
  useEffect(() => {
    if (!authenticated || !id) {
      setUserPositions([]);
      return undefined;
    }
    let cancelled = false;
    fetchPositions()
      .then(r => {
        if (cancelled) return;
        const mid = Number(id);
        const cryptoIds = market?.cryptoMeta
          ? new Set(buildCryptoMarketSequence(market).map((m) => Number(m.id)))
          : null;
        const mine = (r.positions || []).filter(p => {
          if (Number(p.shares) < DISPLAYABLE_SHARE_EPSILON) return false;
          if (cryptoIds) {
            return cryptoIds.has(Number(p.marketId)) || cryptoIds.has(Number(p.parentMarketId));
          }
          return Number(p.marketId) === mid || Number(p.parentMarketId) === mid;
        });
        setUserPositions(mine);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [authenticated, id, buyState, orderBookRefresh, positionRefreshNonce, market?.cryptoMeta, cryptoSequenceSig]);

  async function handleTradeSuccess() {
    await refresh?.();
    try {
      const fresh = await fetchMarket(id);
      applyFreshMarket(fresh);
    } catch { /* no-op */ }
    setPositionRefreshNonce(v => v + 1);
    setOrderBookRefresh(v => v + 1);
    emitPointsRefresh({ source: 'trade_success', marketId: id });
  }

  function handleBuyClick(target, outcomeIndex, outcomeLabel, options = {}) {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    const lockTarget = target || market;
    // Leg targets are synthesised client-side and may not carry gating
    // fields. Fall back to the parent's status rather than treating a
    // missing one as "not active" — that silently kills the click.
    const targetStatus = lockTarget?.status ?? market?.status;
    if (lockTarget?.seriesLocked || targetStatus !== 'active' || market?.seriesLocked || market?.status !== 'active') {
      return;
    }
    setBuyState({
      market: target,
      outcomeIndex,
      outcomeLabel,
      minimumEntrySatisfied: Boolean(options.minimumEntrySatisfied),
    });
  }

  function handleAddParlayLeg({ market: targetMarket, outcomeIndex, outcomeLabel, price }) {
    const nextLeg = buildParlayLeg({
      market: targetMarket,
      fallbackQuestion: market?.question,
      outcomeIndex,
      outcomeLabel,
      price,
    });
    if (!nextLeg) return;
    setParlaySlip(current => addParlayLeg(current, nextLeg));
    setParlayState({
      loading: false,
      submitting: false,
      error: null,
      message: lang === 'en' ? 'Added to combo.' : 'Agregado a combinada.',
      quote: null,
    });
  }

  async function handleQuoteParlay() {
    setParlayState(prev => ({ ...prev, loading: true, error: null, message: null }));
    try {
      const quote = await quoteParlay({
        legs: parlayPayloadLegs(parlaySlip),
        stake: parlayStake,
      });
      setParlayState({
        loading: false,
        submitting: false,
        error: null,
        message: null,
        quote,
      });
    } catch (e) {
      setParlayState({
        loading: false,
        submitting: false,
        error: publicErrorMessage(e, lang, 'parlay_quote_failed'),
        message: null,
        quote: null,
      });
    }
  }

  async function handleCreateParlay() {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    setParlayState(prev => ({ ...prev, submitting: true, error: null, message: null }));
    try {
      const result = await createParlay({
        legs: parlayPayloadLegs(parlaySlip),
        stake: parlayStake,
      });
      setParlaySlip([]);
      setParlayState({
        loading: false,
        submitting: false,
        error: null,
        message: lang === 'en' ? 'Combo created.' : 'Combinada creada.',
        quote: null,
      });
      await refresh?.();
    } catch (e) {
      setParlayState(prev => ({
        ...prev,
        loading: false,
        submitting: false,
        error: publicErrorMessage(e, lang, 'parlay_failed'),
        message: null,
      }));
    }
  }

  function handleRemoveParlayLeg(marketId) {
    setParlaySlip(current => sanitizeParlaySlip(current).filter(leg => leg.marketId !== Number(marketId)));
    setParlayState(prev => ({ ...prev, error: null, message: null, quote: null }));
  }

  function handleClearParlaySlip() {
    setParlaySlip([]);
    setParlayState({ loading: false, submitting: false, error: null, message: null, quote: null });
  }

  async function loadSellPreviewQuote(position, shares) {
    const selectedShares = normalizeSellShares(position, shares);
    const seq = sellQuoteSeqRef.current + 1;
    sellQuoteSeqRef.current = seq;
    setSellPreview({
      position,
      selectedShares,
      maxShares: Number(position.shares) || 0,
      loading: true,
      error: null,
      preview: null,
      quote: null,
      submitting: false,
    });
    try {
      const quote = await quoteSell({
        marketId: position.marketId,
        outcomeIndex: position.outcomeIndex,
        shares: selectedShares,
      });
      if (sellQuoteSeqRef.current !== seq) return;
      const preview = buildSellPreview(position, quote);
      setSellPreview({
        position,
        selectedShares: preview.shares,
        maxShares: preview.maxShares,
        quote,
        preview,
        loading: false,
        error: null,
        submitting: false,
      });
    } catch (e) {
      if (sellQuoteSeqRef.current !== seq) return;
      setSellPreview({
        position,
        selectedShares,
        maxShares: Number(position.shares) || 0,
        loading: false,
        error: publicErrorMessage(e, lang, 'quote_failed'),
        preview: null,
        quote: null,
        submitting: false,
      });
    }
  }

  async function handleSellClick(position) {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    if (!position || market?.status !== 'active') return;
    await loadSellPreviewQuote(position, position.shares);
  }

  function handleSellPreviewSharesChange(shares) {
    if (!sellPreview?.position || sellPreview.submitting) return;
    const position = sellPreview.position;
    const selectedShares = normalizeSellShares(position, shares);
    setSellPreview(prev => prev ? {
      ...prev,
      selectedShares,
      loading: true,
      error: null,
    } : prev);
    if (sellQuoteTimerRef.current) window.clearTimeout(sellQuoteTimerRef.current);
    sellQuoteTimerRef.current = window.setTimeout(() => {
      loadSellPreviewQuote(position, selectedShares);
    }, 220);
  }

  async function confirmSellPreview() {
    if (!sellPreview?.position || !sellPreview?.preview || sellPreview.submitting) return;
    const position = sellPreview.position;
    const preview = sellPreview.preview;
    setSellPreview(prev => prev ? { ...prev, submitting: true, error: null } : prev);
    try {
      await executeSell({
        marketId: position.marketId,
        outcomeIndex: position.outcomeIndex,
        shares: preview.shares,
        minCollateralOut: preview.minCollateralOut,
      });
      setSellPreview(null);
      await refresh?.();
      try {
        const fresh = await fetchMarket(id);
        applyFreshMarket(fresh);
      } catch { /* no-op */ }
      setOrderBookRefresh(v => v + 1);
      setPositionRefreshNonce(v => v + 1);
      emitPointsRefresh({ source: 'sell', marketId: position.marketId });
    } catch (e) {
      setSellPreview(prev => prev ? {
        ...prev,
        submitting: false,
        error: e.code === 'price_moved'
          ? publicErrorMessage(e, lang, 'price_moved')
          : publicErrorMessage(e, lang, 'default'),
      } : prev);
    }
  }

  async function handleRedeemPosition(position) {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    if (!position?.canRedeem) return;
    const key = `${position.marketId}-${position.outcomeIndex}`;
    setRedeemState({ key, message: null, error: null });
    try {
      const r = await redeemWinnings({
        marketId: position.marketId,
        outcomeIndex: position.outcomeIndex,
      });
      setRedeemState({
        key: null,
        message: t('points.detail.claimSuccess', { n: Number(r.payout || 0).toFixed(2) }),
        error: null,
      });
      await handleTradeSuccess();
    } catch (e) {
      setRedeemState({
        key: null,
        message: null,
        error: publicErrorMessage(e, lang, 'default'),
      });
    }
  }

  if (loading) {
    return (
      <div style={{
        textAlign: 'center', padding: '100px 48px',
        fontFamily: 'var(--font-mono)', fontSize: 12,
        letterSpacing: '0.1em', color: 'var(--text-muted)',
      }}>
        {t('points.detail.loading')}
      </div>
    );
  }

  if (error || !market) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 48px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-primary)', marginBottom: 16 }}>
          {t('points.detail.marketNotFound')}
        </h2>
        <button className="btn-ghost" onClick={() => navigate('/')}>{t('points.detail.back')}</button>
      </div>
    );
  }

  // 5-min crypto direction markets get a fully separate layout — live
  // ticker chart + threshold rule + countdown + SUBE/BAJA buttons.
  // Detected via cryptoMeta on the API response (only set when
  // resolver_config.shape === 'binary-direction'). Routed here BEFORE
  // the standard outcome / sparkline layout so the crypto variant
  // doesn't share unrelated state.
  if (market.cryptoMeta) {
    return (
      <main style={{
        padding: isMobile ? '20px 16px 60px' : '40px 48px',
        maxWidth: 1160,
        margin: '0 auto',
      }}>
        <Crypto5MinDetail
          market={market}
          userPositions={userPositions}
          onTradeSuccess={handleTradeSuccess}
          isMobile={isMobile}
        />
      </main>
    );
  }

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));
  const parallelDisplayLegs = market.ammMode === 'parallel' && Array.isArray(market.legs)
    ? sortParallelDisplayLegs(market.legs)
    : null;
  const championsFinalOptions = market.ammMode !== 'parallel' && findChampionsLeagueFinalMarket([market])
    ? finalMarketOptions(market)
    : null;
  const displayOutcomeIndices = Array.isArray(parallelDisplayLegs)
    ? parallelDisplayLegs.map(leg => leg.outcomeIndex)
    : Array.isArray(championsFinalOptions) && championsFinalOptions.length >= 2
    ? championsFinalOptions.map(option => option.outcomeIndex)
    : outcomes.map((_, i) => i);
  const displayOutcomes = Array.isArray(parallelDisplayLegs)
    ? parallelDisplayLegs.map((leg, i) => leg.label || outcomes[leg.outcomeIndex] || `Opción ${i + 1}`)
    : Array.isArray(championsFinalOptions) && championsFinalOptions.length >= 2
    ? championsFinalOptions.map(option => option.label)
    : outcomes;
  const displayPrices = Array.isArray(parallelDisplayLegs)
    ? parallelDisplayLegs.map(leg => parallelLegYesPrice(leg, 1 / Math.max(2, outcomes.length)))
    : Array.isArray(championsFinalOptions) && championsFinalOptions.length >= 2
    ? championsFinalOptions.map(option => option.price)
    : prices;
  const displayOutcomeImages = displayOutcomeIndices.map(i => market.outcomeImages?.[i] || null);
  const displayOutcomeCountryLabels = displayOutcomeIndices.map(i => market.outcomeCountryLabels?.[i] || null);
  const rawHistoryByOutcome = displayOutcomeIndices.map(i => historyByOutcome?.[i] || []);
  const displayActivityByOutcome = displayOutcomeIndices.map(i => activityByOutcome?.[i] || []);
  // Admin's explicit chart-style pick (only meaningful at N=2) wins over
  // the label-based auto-detect below.
  const chartStyleOverride = displayOutcomes.length === 2 ? market.chartStyle : null;
  const useSingleLineChart = chartStyleOverride === 'rivals'
    ? false
    : chartStyleOverride === 'single'
    ? true
    : displayOutcomes.length < 2 || isBinaryYesNoOutcomes(displayOutcomes);
  const activeChartRange = detailChartRangeFor(chartRange);

  // A market opens at even odds and genuinely sits there until someone
  // trades — but the snapshot table only starts recording at the first
  // trade, so the line used to appear already at 88% with no sign of
  // where it came from. When the market was created inside the visible
  // window we seed that real opening price, so the chart shows the move
  // off 50/50 instead of starting mid-story. Outside the window the
  // price really was elsewhere before it opened, so we leave it alone
  // rather than draw a 50% that was never true.
  // Parallel markets run each outcome as its own independent binary
  // (their prices sum well past 100%), so every leg opens at 50%.
  // Standard multi-outcome markets split one book N ways.
  const openingPct = market.ammMode === 'parallel'
    ? 50
    : 100 / Math.max(2, market.outcomes?.length || displayOutcomes.length || 2);
  const marketOpenedAt = market.createdAt
    ? Math.floor(new Date(market.createdAt).getTime() / 1000)
    : null;
  // Both bounds come off one `now` so the window can't skew, and both the
  // opening-baseline seed and the chart axis describe the same span.
  // Polymarket-style clamp: a market younger than the selected range
  // charts its own life (created 8:22 → axis starts 8:22), so every line
  // is born at the left edge instead of floating in an empty canvas.
  const chartWindowEnd = Math.floor(Date.now() / 1000);
  const chartRangeStart = chartWindowEnd - (
    activeChartRange.hours != null
      ? activeChartRange.hours * 3600
      : activeChartRange.days * 86400
  );
  const chartWindowStart = Number.isFinite(marketOpenedAt)
    ? Math.max(chartRangeStart, Math.min(marketOpenedAt, chartWindowEnd - 60))
    : chartRangeStart;
  const withOpeningBaseline = (series) => {
    if (!Array.isArray(series) || series.length === 0) return series;
    if (!Number.isFinite(marketOpenedAt) || marketOpenedAt > chartWindowEnd) return series;
    // Anchor at the market's birth when that falls inside the window, and
    // at the window's start when the market is older. The older case is
    // still truthful: price-history carries the last pre-window price
    // forward to the window start, so a first point later than that means
    // nothing traded before the window and the market was in fact still
    // resting on its opening price when the window opened.
    const anchorT = Math.max(marketOpenedAt, chartWindowStart);
    const firstT = Number(series[0]?.t);
    if (!Number.isFinite(firstT) || firstT <= anchorT) return series;
    return [{ t: anchorT, p: openingPct }, ...series];
  };
  const displayHistoryByOutcome = rawHistoryByOutcome.map(withOpeningBaseline);

  // Movement across the visible window, so the headline number carries
  // the same context the chart does.
  const chartDelta = (() => {
    const series = displayHistoryByOutcome?.[0];
    if (!Array.isArray(series) || series.length < 2) return null;
    const valueAt = (pt) => (pt && typeof pt === 'object' && 'p' in pt ? Number(pt.p) : Number(pt));
    const first = valueAt(series[0]);
    const last = valueAt(series[series.length - 1]);
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    return Math.round(last) - Math.round(first);
  })();
  const activitySummary = summarizeActivity(
    displayOutcomes.length <= 2
      ? [displayActivityByOutcome?.[0] || []]
      : displayActivityByOutcome,
  );
  const latestTradeAt = unixSecondsFromDateLike(market.lastTradeAt) || activitySummary.lastAt;
  const isCanceled = market.status === 'canceled';
  const parallelResolved = !isCanceled
    && market.status === 'resolved'
    && market.ammMode === 'parallel'
    && Array.isArray(parallelDisplayLegs)
    && parallelDisplayLegs.length > 0;
  const winnerIndex = !isCanceled && market.status === 'resolved' && market.outcome != null ? Number(market.outcome) : null;
  const isResolved = parallelResolved || (winnerIndex != null && Number.isFinite(winnerIndex));
  const displayWinnerIndex = isResolved ? displayOutcomeIndices.indexOf(winnerIndex) : null;
  const isTradingLocked = !isResolved && (isCanceled || market.seriesLocked || market.status !== 'active');
  const seriesSubtitle = formatSeriesSubtitle(market.seriesMeta, { t });
  function pctFor(i) {
    if (isResolved) {
      if (market.ammMode === 'parallel' && Array.isArray(parallelDisplayLegs)) {
        return Number(parallelDisplayLegs[i]?.outcome) === 0 ? 100 : 0;
      }
      return displayWinnerIndex === i ? 100 : 0;
    }
    return Math.round((displayPrices[i] ?? 0) * 100);
  }
  // isLive wins over isPendingResolution when start_time has passed
  // but end_time hasn't — the game is in progress and trading stays
  // open. Only sports markets set start_time; everything else falls
  // back to isPendingResolution semantics.
  const _now = new Date();
  const isLive = !isResolved
    && market.status === 'active'
    && market.startTime
    && new Date(market.startTime) <= _now
    && (!market.endTime || new Date(market.endTime) > _now);
  const isPendingResolution = !isResolved
    && !isLive
    && market.status === 'active'
    && market.endTime
    && new Date(market.endTime) < _now;
  const showTemperatureResolutionNote = isTemperatureMarket(market);
  const canTrade = !isResolved && !isPendingResolution && !isTradingLocked;
  const modeCopy = lang === 'en'
    ? { individual: 'Individual', combinada: 'Combo slip', otherMarkets: 'Other markets' }
    : { individual: 'Individual', combinada: 'Combinada', otherMarkets: 'Otros mercados' };

  const tradePanel = (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: 24,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 16,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          {isResolved ? t('points.detail.marketClosed')
           : isPendingResolution ? t('points.detail.awaitingResult')
           : t('points.detail.chooseOutcome')}
        </div>
        {canTrade && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: 3,
            border: '1px solid var(--border)',
            borderRadius: 999,
            background: 'var(--surface2)',
          }}>
            {[
              ['single', modeCopy.individual],
              ['combo', modeCopy.combinada],
            ].map(([key, label]) => {
              const active = tradeMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTradeMode(key)}
                  style={{
                    minHeight: 26,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: `1px solid ${active ? 'rgba(255,85,0,0.42)' : 'transparent'}`,
                    background: active ? 'rgba(255,85,0,0.16)' : 'transparent',
                    color: active ? 'var(--orange)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {canTrade && (
        <>
          {tradeMode === 'combo' && (
            <button
              type="button"
              onClick={() => setComboPickerOpen(true)}
              style={{
                width: '100%',
                minHeight: 34,
                marginBottom: 12,
                borderRadius: 8,
                border: '1px solid rgba(255,85,0,0.34)',
                background: 'rgba(255,85,0,0.08)',
                color: 'var(--orange)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {modeCopy.otherMarkets}
            </button>
          )}
          {market.ammMode === 'parallel' && Array.isArray(market.legs)
            ? <ParallelLegList
                market={market}
                legs={parallelDisplayLegs || market.legs}
                outcomeImages={displayOutcomeImages}
                outcomeCountryLabels={displayOutcomeCountryLabels}
                onBuyClick={handleBuyClick}
                onParlayAdd={handleAddParlayLeg}
                selectionMode={tradeMode}
              />
            : <UnifiedOutcomeList
                outcomes={displayOutcomes}
                prices={displayPrices}
                outcomeImages={displayOutcomeImages}
                outcomeCountryLabels={displayOutcomeCountryLabels}
                outcomeIndices={displayOutcomeIndices}
                market={market}
                onBuyClick={handleBuyClick}
                onParlayAdd={handleAddParlayLeg}
                selectionMode={tradeMode}
              />}
        </>
      )}

      {canTrade && tradeMode === 'combo' && (
        <CombinadaSlipPanel
          legs={parlaySlip}
          stake={parlayStake}
          state={parlayState}
          rules={PARLAY_RULES_FALLBACK}
          lang={lang}
          authenticated={authenticated}
          onStakeChange={(value) => {
            setParlayStake(value);
            setParlayState(prev => ({ ...prev, error: null, message: null, quote: null }));
          }}
          onQuote={handleQuoteParlay}
          onSubmit={handleCreateParlay}
          onRemove={handleRemoveParlayLeg}
          onClear={handleClearParlaySlip}
          onOpenLogin={onOpenLogin}
        />
      )}

      {!canTrade && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {isCanceled
            ? 'Este mercado fue anulado porque el evento no ocurrió. No cuenta como ganado o perdido.'
            : isResolved
            ? t('points.detail.closedHint')
            : t('points.detail.pendingHint')}
        </p>
      )}

      <div style={{
        marginTop: 16,
        paddingTop: 16,
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-muted)',
        letterSpacing: '0.04em',
        lineHeight: 1.6,
      }}>
        <p style={{ margin: 0 }}>
          {t('points.detail.mxnpNote')}
        </p>
        {showTemperatureResolutionNote && (
          <div style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
          }}>
            <p style={{
              margin: '0 0 6px',
              color: 'var(--text-primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}>
              {t('points.detail.temperatureResolutionTitle')}
            </p>
            <p style={{ margin: 0 }}>
              {t('points.detail.temperatureResolutionBody')}
            </p>
          </div>
        )}
        {displayOutcomes.length === 2 && !isResolved && !isCanceled && (
          <p style={{
            margin: '10px 0 0',
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
          }}>
            {t('points.detail.probExplain')}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <main style={{
        padding: isMobile ? '20px 16px 60px' : '40px 48px',
        maxWidth: 1160,
        margin: '0 auto',
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 24,
          }}
        >
          {t('points.detail.backToMarkets')}
        </button>

        <div style={{
          display: 'grid',
          // On phones, stack the buy panel below the market info so we
          // get the full viewport width for the question / chart / odds.
          gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 360px',
          gap: isMobile ? 24 : 40,
          alignItems: 'start',
        }}>
          {/* Left column: market info */}
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 10,
            }}>
              <span>{market.category || 'General'}</span>
              {isResolved && (
                <span style={{ color: 'var(--green)' }}>{t('points.detail.resolvedBadge')}</span>
              )}
              {isCanceled && (
                <span style={{ color: 'var(--text-muted)' }}>ANULADO</span>
              )}
              {isLive && (
                <span style={{
                  color: 'var(--danger)',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
                }}>
                  · {t('points.card.live')}
                </span>
              )}
              {isPendingResolution && !isResolved && !isLive && (
                <span style={{ color: 'var(--warning)' }}>{t('points.detail.pendingBadge')}</span>
              )}
              {isTradingLocked && !isResolved && !isCanceled && (
                <span style={{ color: 'var(--warning)' }}>· {t('points.series.pending')}</span>
              )}
              <span style={{ flex: 1 }} />
              {market.isTestMarket && (
                <span className="test-market-badge" title={t('points.testMarket.tooltip')}>
                  {t('points.testMarket.badge')}
                </span>
              )}
              <ShareButton marketId={market.id} app="points" question={market.question} />
            </div>

            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(26px, 3vw, 38px)',
              lineHeight: 1.2,
              color: 'var(--text-primary)',
              marginBottom: seriesSubtitle ? 8 : (market.finalScore && isResolved ? 12 : 24),
            }}>
              {market.question}
            </h1>

            {seriesSubtitle && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: market.finalScore && isResolved ? 12 : 24,
              }}>
                {seriesSubtitle}
              </div>
            )}

            <TeamMarketStrip market={market} outcomeImages={market.outcomeImages} />
            <TokenMarketStrip market={market} />
            <LiveScorePanel market={market} />

            {isCanceled && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderRadius: 10,
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                marginBottom: 24,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-secondary)',
                letterSpacing: '0.03em',
              }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Mercado anulado</span>
                <span>Las posiciones abiertas fueron devueltas.</span>
              </div>
            )}

            {/* Final-score strip — shown right below the question on resolved
                markets whose resolver filled in a score / result. */}
            {isResolved && market.finalScore && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderRadius: 10,
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                marginBottom: 24,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-primary)',
                letterSpacing: '0.03em',
              }}>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>FINAL</span>
                <span>{market.finalScore}</span>
              </div>
            )}

            {isResolved && (
              <TranscriptEvidencePanel
                evidence={market.transcriptEvidence}
                isAdmin={isAdmin}
                locale={numberLocale}
              />
            )}

            {displayOutcomes.length === 2 && isResolved && (
              <div style={{
                marginBottom: 24,
                padding: '18px 20px',
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                borderRadius: 14,
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
                  {t('points.detail.resultOfficial')}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green)' }}>
                  {displayWinnerIndex >= 0 ? displayOutcomes[displayWinnerIndex] : outcomes[winnerIndex]}
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>
                  {t('points.detail.redeemInstructions')}
                </p>
              </div>
            )}

            {/* Price history chart — shows real probability snapshots
                plus real trade activity. If there are no snapshots yet,
                Sparkline renders an explicit flat/empty state instead
                of inventing movement. */}
            <div style={{
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              marginBottom: 24,
            }}>
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'var(--text-muted)',
              }}>
                <span>{isResolved ? t('points.detail.priceHistory') : t('points.detail.priceRealtime')}</span>
                <div
                  role="group"
                  aria-label={t('points.detail.chartRange')}
                  style={{
                    display: 'inline-flex',
                    gap: 4,
                    padding: 3,
                    border: '1px solid var(--border)',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  {DETAIL_CHART_RANGES.map((range) => {
                    const active = range.key === activeChartRange.key;
                    return (
                      <button
                        key={range.key}
                        type="button"
                        onClick={() => {
                          chartRangeTouchedRef.current = true;
                          setChartRange(range.key);
                        }}
                        style={{
                          border: 0,
                          borderRadius: 999,
                          padding: '5px 9px',
                          background: active ? 'rgba(255,85,0,0.16)' : 'transparent',
                          color: active ? 'var(--orange)' : 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                      >
                        {t(range.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ padding: '20px 20px 18px', position: 'relative' }}>
                <ChartWatermark />
                {/* Video demo only: floating per-order labels over the chart. */}
                {isVideoDemoActive() && (
                  <Suspense fallback={null}>
                    <DemoTradeFlares marketId={id} />
                  </Suspense>
                )}
                {useSingleLineChart && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    marginBottom: 10,
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 30,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: OUTCOME_COLORS[0],
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {Math.round(pctFor(0))}%
                    </span>
                    {chartDelta != null && chartDelta !== 0 && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        fontWeight: 700,
                        color: chartDelta > 0 ? 'var(--yes)' : '#ff3b3b',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {chartDelta > 0 ? '▲' : '▼'} {Math.abs(chartDelta)}%
                      </span>
                    )}
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}>
                      {t(activeChartRange.labelKey)}
                    </span>
                  </div>
                )}
                {/* True Sí/No markets show one taller chart with just the
                    YES line (the NO line is its mirror, no extra info).
                    Everything else — two named rivals or 3+ outcomes —
                    draws every curve on ONE shared axis, Polymarket-style:
                    stacked rows each had their own baseline, so a 20%
                    line and a 95% line looked the same height and the
                    reader could not compare them. One color per option,
                    matching the buy buttons below. */}
                {useSingleLineChart ? (
                  <Sparkline
                    height={200}
                    color={OUTCOME_COLORS[0]}
                    strokeWidth={1.5}
                    fill={false}
                    showValue={false}
                    domainMin={0}
                    domainMax={100}
                    timeMin={chartWindowStart}
                    timeMax={chartWindowEnd}
                    data={displayHistoryByOutcome?.[0] || []}
                    activity={displayActivityByOutcome?.[0] || []}
                    targetPct={pctFor(0)}
                    seed={`points-detail-${market.id}-${displayOutcomes[0] || 'yes'}`}
                    emptyLabel="Sin actividad todavía"
                    emptySubLabel="El precio se moverá con el primer trade."
                  />
                ) : (
                  // Chart shows the current leaders. Parallel tournament
                  // markets can append a couple of resolved-to-zero lines
                  // so users see who dropped out without burying live legs.
                  // Color stays tied to the outcome's ORIGINAL index so it
                  // matches the color in the buy-list below.
                  (() => {
                    const chartIndices = chartOutcomeIndicesForDisplay({
                      displayOutcomes,
                      displayPrices,
                      displayActivityByOutcome,
                      parallelDisplayLegs,
                    });
                    return (
                      <MultiSparkline
                        height={240}
                        strokeWidth={1.5}
                        domainMin={0}
                        domainMax={100}
                        timeMin={chartWindowStart}
                        timeMax={chartWindowEnd}
                        series={chartIndices.map((i) => ({
                          key: `opt-${i}`,
                          label: displayOutcomes[i],
                          color: chartColorFor(i, displayOutcomes.length),
                          data: Array.isArray(displayHistoryByOutcome?.[i])
                            ? displayHistoryByOutcome[i]
                            : [],
                          targetPct: pctFor(i),
                        }))}
                        activity={chartIndices.map(i => displayActivityByOutcome?.[i] || [])}
                        emptyLabel="Sin actividad todavía"
                        emptySubLabel="El precio se moverá con el primer trade."
                        legendNote={displayOutcomes.length > 4 ? (
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--text-muted)',
                            letterSpacing: '0.04em',
                            alignSelf: 'center',
                          }}>
                            {t('points.detail.topOnly', { n: displayOutcomes.length })}
                          </span>
                        ) : null}
                      />
                    );
                  })()
                )}
                <MarketActivityStrip
                  summary={activitySummary}
                  rangeLabel={t(activeChartRange.labelKey)}
                  lastTradeAt={latestTradeAt}
                  locale={numberLocale}
                  t={t}
                />
              </div>
            </div>

            {isMobile && tradePanel}

            <PointsActivityTape
              items={tradeTape}
              maxRows={24}
              showTradeDetails={isAdmin}
            />

            <OrderBookPanel
              market={market}
              displayOutcomes={displayOutcomes}
              displayOutcomeIndices={displayOutcomeIndices}
              displayOutcomeImages={displayOutcomeImages}
              parallelDisplayLegs={parallelDisplayLegs}
              disabled={isResolved || isPendingResolution || isTradingLocked || isCanceled}
              authenticated={authenticated}
              onOpenLogin={onOpenLogin}
              refreshKey={orderBookRefresh}
              onOrderChange={async () => {
                setOrderBookRefresh(v => v + 1);
                try {
                  const fresh = await fetchMarket(id);
                  applyFreshMarket(fresh);
                } catch { /* best-effort */ }
              }}
            />

            <SeriesGameStrip
              seriesMeta={market.seriesMeta}
              currentMarketId={market.id}
              navigate={navigate}
              t={t}
            />

            {displayOutcomes.length === 2 && (
              <ProbabilityGaugeRow
                outcomes={displayOutcomes}
                outcomeImages={displayOutcomeImages}
                pctFor={pctFor}
                isResolved={isResolved}
                winnerIndex={displayWinnerIndex}
              />
            )}

            {/* Parallel markets keep a read-only odds snapshot below
                the trade/orderbook area. The actual Sí/No buy controls
                stay immediately after the graph on phones and in the
                right column on desktop. */}
            {market.ammMode === 'parallel' && Array.isArray(market.legs) && !isResolved && !isPendingResolution && (
              <div style={{ marginBottom: 32 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}>
                  {t('points.detail.oddsNow')}
                </div>
                <div style={{
                  background: 'var(--surface1)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 18,
                }}>
                  <OddsSummary
                    outcomes={displayOutcomes}
                    prices={displayPrices}
                    outcomeImages={displayOutcomeImages}
                    outcomeCountryLabels={displayOutcomeCountryLabels}
                  />
                </div>
              </div>
            )}

            {/* Unified multi (N>2): read-only option grid under the
                chart so the user sees every outcome's percentage. The
                actual voting stays in the trade panel near the graph.
                Parallel uses the calmer "Odds actuales" snapshot above. */}
            {displayOutcomes.length > 2 && market.ammMode !== 'parallel' && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 32,
                // Many outcomes (rare on unified, but guard anyway):
                // cap height and scroll so the grid doesn't push the
                // rest of the page off-screen.
                ...(displayOutcomes.length > 8 ? {
                  maxHeight: 320,
                  overflowY: 'auto',
                } : null),
              }}>
                {displayOutcomes.map((label, i) => {
                  const pct = pctFor(i);
                  const isWin = isResolved && displayWinnerIndex === i;
                  const logo = displayOutcomeImages?.[i] || null;
                  const countryLabel = displayOutcomeCountryLabels?.[i] || null;
                  return (
                    <div key={i} style={{
                      padding: '16px',
                      background: isWin ? 'rgba(0,232,122,0.08)' : 'var(--surface1)',
                      border: `1px solid ${isWin ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                      borderRadius: 12,
                      opacity: isResolved && !isWin ? 0.5 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <OutcomeLogo src={logo} label={label} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          letterSpacing: '0.06em',
                          marginBottom: 6,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {label.toUpperCase()}
                        </div>
                        <CountryChip label={countryLabel} />
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: isWin ? 'var(--green)' : 'var(--text-primary)' }}>
                          {pct}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Comments — sits between the trade area and the meta strip
                so the discussion stays adjacent to the market but below
                the actionable UI. */}
            <MarketComments
              marketId={market.id}
              authenticated={authenticated}
              username={user?.username}
              onOpenLogin={onOpenLogin}
            />

            {/* Meta */}
            <div style={{
              display: 'flex',
              gap: 32,
              padding: '16px 0',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {isResolved ? t('points.detail.closedLabel') : t('points.detail.closesLabel')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {formatDeadline(market.endTime)}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {t('points.detail.volumeLabel')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {Number(market.tradeVolume || market.volume || 0).toLocaleString('es-MX')} MXNP
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {t('points.detail.stateLabel')}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontWeight: isLive ? 700 : 400,
                  color: isResolved ? 'var(--green)'
                       : isLive ? 'var(--danger)'
                       : isPendingResolution ? 'var(--warning)'
                       : 'var(--text-primary)',
                }}>
                  {isResolved ? t('points.detail.stateResolved')
                   : isLive ? t('points.card.live')
                   : isPendingResolution ? t('points.detail.statePending')
                   : t('points.detail.stateActive')}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {t('points.detail.resolverLabel')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {resolverLabel(market.resolverType, market.resolverSource) || t('points.detail.resolverAdmin')}
                </div>
              </div>
            </div>
            {market.resolutionCriteria && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'var(--text-muted)',
                paddingBottom: 4,
              }}>
                <div style={{
                  fontSize: 10,
                  letterSpacing: 0,
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}>
                  {t('points.detail.criteriaLabel')}
                </div>
                <div>{market.resolutionCriteria}</div>
              </div>
            )}
          </div>

          {/* Right column: buy panel + user-position panel + holders */}
          <aside style={{
            position: isMobile ? 'static' : 'sticky',
            top: isMobile ? undefined : 80,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>

          {!isMobile && tradePanel}

            {/* ── Tu posición ───────────────────────────────────────
                Shows shares held per outcome when the user is signed in.
                "Vender" opens the same quote-first AMM preview used in
                Portfolio, without leaving the market detail.
            */}
            {authenticated && userPositions.length > 0 && (
              <div style={{
                background: 'var(--surface1)',
                border: '1px solid rgba(0,232,122,0.25)',
                borderRadius: 14,
                padding: '18px 22px',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  color: 'var(--green)',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}>
                  {t('points.detail.yourPos')}
                </div>
                {(redeemState.message || redeemState.error) && (
                  <div style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${redeemState.error ? 'rgba(239,68,68,0.35)' : 'rgba(0,232,122,0.28)'}`,
                    background: redeemState.error ? 'rgba(239,68,68,0.08)' : 'rgba(0,232,122,0.08)',
                    color: redeemState.error ? 'var(--red, #ef4444)' : 'var(--green)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}>
                    {redeemState.error || redeemState.message}
                  </div>
                )}
                {userPositions.map(p => {
                  const oi = Number(p.outcomeIndex);
                  // Prefer positions.js's composed label ("Leg — Sí/No"
                  // for parallel, raw outcome label for unified) since
                  // it already knows whether this sits on a leg or the
                  // parent directly.
                  const label = p.outcomeLabel || outcomes[oi] || `Opción ${oi + 1}`;
                  const shares = Number(p.shares) || 0;
                  // Use the backend-computed currentPrice so parallel
                  // leg positions get the leg's YES/NO price rather than
                  // the parent's aggregated one.
                  const currentPrice = Number(p.currentPrice ?? prices[oi] ?? 0);
                  const markValue = shares * currentPrice;
                  const costBasis = Number(p.costBasis) || 0;
                  const pnl = markValue - costBasis;
                  const pnlPos = pnl >= 0;
                  // "Comprar más" opens the modal against the leg
                  // market for parallel, parent for unified. The leg's
                  // gating fields have to come along or handleBuyClick
                  // reads the target as inactive and does nothing.
                  const positionLeg = p.parentMarketId
                    ? market.legs?.find(l => Number(l.id) === Number(p.marketId))
                    : null;
                  const buyTarget = p.parentMarketId
                    ? {
                        id: p.marketId,
                        question: `${market.question} — ${label}`,
                        status: positionLeg?.status ?? market.status,
                        seriesLocked: positionLeg?.seriesLocked ?? market.seriesLocked,
                      }
                    : market;
                  const redeemKey = `${p.marketId}-${oi}`;
                  const isRedeeming = redeemState.key === redeemKey;
                  return (
                    <div key={`${p.marketId}-${oi}`} style={{
                      padding: '10px 0',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{
                          fontFamily: 'var(--font-body)',
                          fontSize: 13,
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                        }}>
                          {label}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}>
                          {t('points.detail.shares', { n: shares.toFixed(2) })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {t('points.detail.valueLabel')}: <span style={{ color: 'var(--text-primary)' }}>{markValue.toFixed(2)} MXNP</span>
                        </span>
                        <span style={{ color: pnlPos ? 'var(--success)' : 'var(--danger)' }}>
                          {pnlPos ? '+' : ''}{pnl.toFixed(2)} PnL
                        </span>
                      </div>
                      {!isResolved && !isPendingResolution && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleBuyClick(buyTarget, oi, label, { minimumEntrySatisfied: true })}
                            className="btn-primary"
                            style={{ flex: 1, padding: '8px 10px', fontSize: 11 }}
                          >
                            {t('points.detail.buyMore')}
                          </button>
                          <button
                            onClick={() => handleSellClick(p)}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              fontSize: 11,
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              color: 'var(--text-secondary)',
                              fontFamily: 'var(--font-mono)',
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                              cursor: 'pointer',
                            }}
                          >
                            {t('points.detail.sell')}
                          </button>
                        </div>
                      )}
                      {isResolved && p.canRedeem && (
                        <button
                          onClick={() => handleRedeemPosition(p)}
                          className="btn-primary"
                          disabled={isRedeeming}
                          style={{ padding: '9px 12px', fontSize: 11 }}
                        >
                          {isRedeeming ? t('points.detail.claiming') : t('points.detail.claim')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          {/* Top holders — read-only social-proof panel. Refreshes after
              local trades and remote polling so it reflects live movement. */}
          <TopHolders marketId={market.id} refreshKey={orderBookRefresh} />

          </aside>
        </div>
      </main>

      <CombinadaMarketPickerDrawer
        open={comboPickerOpen}
        onClose={() => setComboPickerOpen(false)}
        legs={parlaySlip}
        stake={parlayStake}
        state={parlayState}
        rules={PARLAY_RULES_FALLBACK}
        lang={lang}
        authenticated={authenticated}
        onStakeChange={(value) => {
          setParlayStake(value);
          setParlayState(prev => ({ ...prev, error: null, message: null, quote: null }));
        }}
        onQuote={handleQuoteParlay}
        onSubmit={handleCreateParlay}
        onRemove={handleRemoveParlayLeg}
        onClear={handleClearParlaySlip}
        onOpenLogin={onOpenLogin}
        onAddLeg={handleAddParlayLeg}
      />

      {buyState && (
        <PointsBuyModal
          open
          // buyState.market points at the leg for parallel markets and
          // the parent otherwise, so the modal's quote/buy calls always
          // route to the correct binary CPMM state.
          market={buyState.market || market}
          outcomeIndex={buyState.outcomeIndex}
          outcomeLabel={buyState.outcomeLabel}
          minimumEntrySatisfied={buyState.minimumEntrySatisfied}
          onClose={() => setBuyState(null)}
          onSuccess={async () => {
            setBuyState(null);
            await handleTradeSuccess();
          }}
        />
      )}
      <PointsSellPreviewModal
        state={sellPreview}
        onClose={() => {
          if (!sellPreview?.submitting) setSellPreview(null);
        }}
        onConfirm={confirmSellPreview}
        onSharesChange={handleSellPreviewSharesChange}
      />
    </>
  );
}
