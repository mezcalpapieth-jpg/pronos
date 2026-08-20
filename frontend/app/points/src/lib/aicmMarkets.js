export const AICM_HUB_PATH = '/c/infraestructura/aicm';

export const AICM_DELAY_SOURCES = new Set([
  'aicm-official-flight-board',
  'aviation-edge-timetable',
]);

export function isAicmDelayMarket(m) {
  const cfg = m?.resolverConfig || {};
  const source = String(m?.source || cfg.source || '');
  const sourceEventId = String(m?.sourceEventId || cfg.sourceEventId || '');
  return AICM_DELAY_SOURCES.has(source)
    && sourceEventId.includes(':departure:')
    && String(cfg.shape || '') === 'delay-bucket';
}
