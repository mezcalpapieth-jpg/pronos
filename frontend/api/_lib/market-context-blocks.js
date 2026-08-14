const STYLE_VERSION = 1;
const MAX_STATIC_WORDS = 78;

export const MARKET_CONTEXT_BLOCK_STYLE = {
  version: STYLE_VERSION,
  name: 'pronos-polymarket-context-v1',
  staticBlock: {
    maxWords: MAX_STATIC_WORDS,
    requiredSource: true,
    requiredShape: [
      'Short neutral context paragraph with one credible dated source URL.',
      'Second paragraph starts with "This market will resolve to \'Yes\' if".',
      'Second paragraph ends with "Otherwise, this market will resolve to \'No.\'"',
    ],
  },
  dynamicBlock: {
    minWords: 60,
    maxWords: 90,
    disclaimer:
      'Experimental AI-generated summary referencing Pronos market data. This is not trading advice and plays no role in how this market resolves.',
  },
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function trimString(value, maxLen = 1000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeUrl(value) {
  const url = trimString(value, 1200);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

function extractUrlsFromEvidence(evidence) {
  const urls = [];
  for (const item of asArray(evidence)) {
    if (typeof item === 'string') {
      const url = normalizeUrl(item);
      if (url) urls.push(url);
      continue;
    }
    const obj = asObject(item);
    for (const key of ['url', 'href', 'sourceUrl', 'source_url', 'evidenceUrl', 'evidence_url']) {
      const url = normalizeUrl(obj[key]);
      if (url) urls.push(url);
    }
  }
  return urls;
}

export function extractMarketSourceUrls(spec = {}) {
  const resolverConfig = asObject(spec.resolver_config || spec.resolverConfig);
  const sourceData = asObject(spec.source_data || spec.sourceData);
  const nested = asObject(sourceData.context || sourceData.marketContext);

  const candidates = [
    spec.resolutionSource,
    spec.resolution_source,
    spec.sourceUrl,
    spec.source_url,
    resolverConfig.evidenceUrl,
    resolverConfig.evidence_url,
    resolverConfig.resolutionSource,
    resolverConfig.resolution_source,
    sourceData.sourceUrl,
    sourceData.source_url,
    sourceData.resolutionSource,
    sourceData.resolution_source,
    nested.sourceUrl,
    nested.source_url,
    ...asArray(resolverConfig.sourceUrls),
    ...asArray(resolverConfig.source_urls),
    ...asArray(sourceData.sourceUrls),
    ...asArray(sourceData.source_urls),
    ...extractUrlsFromEvidence(resolverConfig.evidence),
    ...extractUrlsFromEvidence(sourceData.evidence),
    ...extractUrlsFromEvidence(sourceData.sources),
    ...extractUrlsFromEvidence(sourceData.snapshot),
  ];

  const urls = [];
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function extractMarketResolutionCriteria(spec = {}) {
  const resolverConfig = asObject(spec.resolver_config || spec.resolverConfig);
  const sourceData = asObject(spec.source_data || spec.sourceData);
  const nested = asObject(sourceData.context || sourceData.marketContext);
  return trimString(
    resolverConfig.criteria
      || resolverConfig.resolutionCriteria
      || resolverConfig.resolution_criteria
      || sourceData.resolutionCriteria
      || sourceData.resolution_criteria
      || nested.resolutionCriteria
      || nested.resolution_criteria
      || resolverConfig.rationale,
    1500,
  );
}

function isBinaryYesNo(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length !== 2) return false;
  const normalized = outcomes.map(normalizeText);
  return normalized.includes('si') && normalized.includes('no');
}

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function truncateWords(text, maxWords) {
  const parts = words(text);
  if (parts.length <= maxWords) return text.trim();
  return parts.slice(0, maxWords).join(' ');
}

function lowerFirst(text) {
  const value = trimString(text, 1500);
  if (!value) return '';
  return value.charAt(0).toLowerCase() + value.slice(1).replace(/[.。]\s*$/, '');
}

function formatUtcStamp(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return { date: null, time: null };
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}

export function buildMarketIntelligenceDisclaimer(now = new Date()) {
  const stamp = formatUtcStamp(now);
  return `${MARKET_CONTEXT_BLOCK_STYLE.dynamicBlock.disclaimer} · Updated ${stamp.date}, ${stamp.time} UTC`;
}

export function buildStaticMarketContextBlock(spec = {}) {
  const question = trimString(spec.question, 500);
  const category = trimString(spec.category, 120) || 'general';
  const resolutionDateTime = trimString(spec.end_time || spec.endTime || spec.resolutionDateTime, 120);
  const sourceUrl = extractMarketSourceUrls(spec)[0] || null;
  const criteria = extractMarketResolutionCriteria(spec);
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];

  const missing = [];
  if (!question) missing.push('question');
  if (!resolutionDateTime) missing.push('resolutionDateTime');
  if (!sourceUrl) missing.push('sourceUrl');
  if (!criteria) missing.push('resolutionCriteria');
  if (!isBinaryYesNo(outcomes)) missing.push('binaryYesNoOutcomes');

  if (missing.length) {
    return { text: null, missing };
  }

  const context = `This ${category} market tracks the stated event through its scheduled resolution time, using the cited source as the primary reference (see: ${sourceUrl}).`;
  const criteriaWordBudget = Math.max(8, MAX_STATIC_WORDS - words(context).length - 14);
  const criteriaText = truncateWords(lowerFirst(criteria), criteriaWordBudget);
  const resolution = `This market will resolve to 'Yes' if ${criteriaText}. Otherwise, this market will resolve to 'No.'`;
  return { text: `${context}\n\n${resolution}`, missing: [] };
}

export function buildMarketContextBlocks(spec = {}, { now = new Date() } = {}) {
  const sourceUrls = extractMarketSourceUrls(spec);
  const criteria = extractMarketResolutionCriteria(spec);
  const staticBlock = buildStaticMarketContextBlock(spec);
  return {
    version: STYLE_VERSION,
    style: MARKET_CONTEXT_BLOCK_STYLE.name,
    marketInput: {
      question: trimString(spec.question, 500),
      resolutionDateTime: trimString(spec.end_time || spec.endTime || spec.resolutionDateTime, 120),
      category: trimString(spec.category, 120),
      sourceUrl: sourceUrls[0] || null,
      sourceUrls,
    },
    contextResolutionCriteria: staticBlock.text,
    marketIntelligenceSummary: null,
    dynamicSummary: {
      status: 'needs_refresh',
      disclaimer: buildMarketIntelligenceDisclaimer(now),
      updatedAt: null,
    },
    resolutionCriteria: criteria || null,
    missing: staticBlock.missing,
  };
}

export function attachMarketContextBlocks(spec = {}, options = {}) {
  const sourceData = asObject(spec.source_data || spec.sourceData);
  return {
    ...spec,
    source_data: {
      ...sourceData,
      contextBlocks: buildMarketContextBlocks(spec, options),
    },
  };
}
