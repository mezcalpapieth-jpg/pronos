import { MANANERA_TRANSCRIPT_SOURCE } from './mananera.js';

function cleanPhrase(value) {
  const phrase = String(value || '').replace(/\s+/g, ' ').trim();
  if (!phrase || phrase.length > 160) return null;
  return phrase;
}

export function extractFirstQuotedPhrase(text) {
  const source = String(text || '');
  const quotePairs = [
    ['"', '"'],
    ['“', '”'],
    ['«', '»'],
  ];
  for (const [open, close] of quotePairs) {
    const start = source.indexOf(open);
    if (start < 0) continue;
    const end = source.indexOf(close, start + open.length);
    if (end <= start) continue;
    const phrase = cleanPhrase(source.slice(start + open.length, end));
    if (phrase) return phrase;
  }
  return null;
}

function rewriteFirstQuotedPhrase(text, phrase) {
  if (typeof text !== 'string' || !text) return text;
  const quotePairs = [
    ['"', '"'],
    ['“', '”'],
    ['«', '»'],
  ];
  for (const [open, close] of quotePairs) {
    const start = text.indexOf(open);
    if (start < 0) continue;
    const end = text.indexOf(close, start + open.length);
    if (end <= start) continue;
    return `${text.slice(0, start + open.length)}${phrase}${text.slice(end)}`;
  }
  return text;
}

export function syncMananeraPhraseFromQuestion({
  question,
  resolverConfig,
  sourceData = null,
} = {}) {
  const cfg = resolverConfig && typeof resolverConfig === 'object' && !Array.isArray(resolverConfig)
    ? resolverConfig
    : null;
  if (!cfg || cfg.source !== MANANERA_TRANSCRIPT_SOURCE) {
    return { resolverConfig, sourceData, phrase: null, changed: false };
  }

  const phrase = extractFirstQuotedPhrase(question);
  if (!phrase) {
    return { resolverConfig, sourceData, phrase: null, changed: false };
  }

  const nextConfig = {
    ...cfg,
    phrase,
  };
  if (typeof cfg.criteria === 'string') {
    nextConfig.criteria = rewriteFirstQuotedPhrase(cfg.criteria, phrase);
  }

  const hasSourceData = sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData);
  const nextSourceData = hasSourceData
    ? { ...sourceData, phrase }
    : sourceData;

  return {
    resolverConfig: nextConfig,
    sourceData: nextSourceData,
    phrase,
    changed: cfg.phrase !== phrase || (hasSourceData && sourceData.phrase !== phrase),
  };
}
