import { BANXICO_FIX_RESOLUTION_CRITERIA } from './banxico.js';
import { COINGECKO_TOKEN_MCAP_SOURCE } from './solana-token-mcap.js';

const PRICE_SOURCES = new Set(['finnhub', 'banxico-fix', 'cre-gasolina', COINGECKO_TOKEN_MCAP_SOURCE]);

function asObject(value, fallback = null) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseNumber(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let normalized = text.replace(/\s/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '');
  } else if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function applyMagnitude(value, suffix) {
  if (!Number.isFinite(value)) return value;
  const s = String(suffix || '').trim().toLowerCase();
  if (s === 'k') return value * 1000;
  if (s === 'm') return value * 1000000;
  if (s === 'b') return value * 1000000000;
  return value;
}

function parseThresholdAmount(raw, suffix) {
  const value = parseNumber(raw);
  if (value == null) return null;
  return applyMagnitude(value, suffix);
}

function extractThreshold(question) {
  const q = String(question || '');
  const money = q.match(/\$\s*([0-9][0-9.,]*)\s*([kKmMbB])?\b/);
  if (money) return parseThresholdAmount(money[1], money[2]);

  const directional = q.match(
    /(?:below|under|less than|debajo de|por debajo de|menor(?:\s+(?:que|a))?|menos de|baja de|above|over|greater than|encima de|por encima de|mayor(?:\s+(?:que|a))?|arriba de|supera)\s*\$?\s*([0-9][0-9.,]*)\s*([kKmMbB])?\b/i,
  );
  if (directional) return parseThresholdAmount(directional[1], directional[2]);

  return null;
}

function inferOperator(question, fallback) {
  const q = String(question || '').toLowerCase();
  if (/(<=|≤|menor\s+o\s+igual|below\s+or\s+equal|at\s+or\s+below|no\s+supera)/i.test(q)) return 'lte';
  if (/(>=|≥|mayor\s+o\s+igual|above\s+or\s+equal|at\s+or\s+above|al\s+menos)/i.test(q)) return 'gte';
  if (/(<|below|under|less\s+than|debajo\s+de|por\s+debajo\s+de|menor(?:\s+(?:que|a))?|menos\s+de|baja\s+de)/i.test(q)) return 'lt';
  if (/(>|above|over|greater\s+than|encima\s+de|por\s+encima\s+de|mayor(?:\s+(?:que|a))?|arriba\s+de|supera)/i.test(q)) return 'gt';
  return fallback;
}

function sameNumber(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.000001;
}

export function syncApiPriceFromQuestion({
  question,
  resolverConfig,
  sourceData,
} = {}) {
  const cfg = asObject(resolverConfig, null);
  if (!cfg || !PRICE_SOURCES.has(String(cfg.source || ''))) {
    return {
      resolverConfig,
      sourceData,
      changed: false,
    };
  }

  const nextConfig = { ...cfg };
  const data = asObject(sourceData, {}) || {};
  const nextSourceData = { ...data };
  let changed = false;

  if (nextConfig.source === 'banxico-fix') {
    if (!nextConfig.criteria) {
      nextConfig.criteria = BANXICO_FIX_RESOLUTION_CRITERIA;
      changed = true;
    }
    if (!nextConfig.rationale) {
      nextConfig.rationale = nextConfig.criteria || BANXICO_FIX_RESOLUTION_CRITERIA;
      changed = true;
    }
    if (nextSourceData.resolutionCriteria !== BANXICO_FIX_RESOLUTION_CRITERIA) {
      nextSourceData.resolutionCriteria = BANXICO_FIX_RESOLUTION_CRITERIA;
      changed = true;
    }
  }

  const threshold = extractThreshold(question);
  if (threshold != null && !sameNumber(nextConfig.threshold, threshold)) {
    nextConfig.threshold = threshold;
    nextSourceData.strike = threshold;
    changed = true;
  }

  const op = inferOperator(question, nextConfig.op);
  if (op && op !== nextConfig.op) {
    nextConfig.op = op;
    changed = true;
  }

  return {
    resolverConfig: changed ? nextConfig : cfg,
    sourceData: changed ? nextSourceData : sourceData,
    threshold,
    op,
    changed,
  };
}
