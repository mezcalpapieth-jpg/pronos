import { aviationEdgeEnabled, isAviationEdgeMarket } from './points-aicm-policy.js';

export function pointsResolverReadiness(market = {}) {
  const type = market.resolver_type || market.resolverType;
  const cfg = market.resolver_config || market.resolverConfig || {};
  if (isAviationEdgeMarket(market) && !aviationEdgeEnabled()) {
    return { mode: 'blocked', label: 'Fuente suspendida · Aviation Edge', requirement: 'No publicar mercados del aeropuerto hasta restablecer la fuente y verificar su cobertura.' };
  }
  if (!type) return { mode: 'missing', label: 'Sin resolver', requirement: 'Configurar un resolver antes de publicar.' };
  if (!['manual', 'manual_review'].includes(type)) {
    const automatic = ['chainlink_price', 'api_price', 'weather_api', 'api_chart', 'api_transcript', 'sports_api', 'api_hurricane', 'aicm_delay_minutes', 'aicm_delay_minutes_live', 'aicm_delay_count'].includes(type);
    return automatic
      ? { mode: 'automatic', label: 'Resolución automática', requirement: 'Espera evidencia completa de la fuente configurada.' }
      : { mode: 'manual', label: 'Revisión manual', requirement: `El tipo ${type} no tiene automatización reconocida.` };
  }
  const source = ['manual_review', 'manual-review'].includes(cfg.source) ? market.source : cfg.source || market.source;
  let requirement = 'Un administrador debe verificar los criterios y adjuntar evidencia antes de resolver.';
  let requiresCutoffSnapshot = false;
  if (source === 'ai-lab-top-model') {
    requiresCutoffSnapshot = true;
    requirement = 'Guardar la tabla y puntuaciones de Artificial Analysis al corte; verificar el modelo de este laboratorio y los desempates. No usar rankings posteriores.';
  } else if (cfg.manualReviewKind === 'inegi_inflation_bucket' || source === 'inegi') {
    requirement = 'Verificar el primer comunicado de INEGI del periodo exacto; no sustituirlo por una serie revisada ni por el dato quincenal.';
  } else if (/politics/.test(source || '')) {
    requirement = 'Revisar el acto oficial y las fuentes admitidas por el contrato; una noticia o propuesta no siempre acredita el evento.';
  } else if (/release|delay|model/.test(source || '') || ['ai', 'popular'].includes(market.category) || source === 'popular') {
    requirement = 'Verificar el anuncio oficial y los requisitos de disponibilidad o aplazamiento del contrato; no basta un rumor o una beta privada.';
  }
  return { mode: 'manual', label: 'Revisión manual · no se resuelve automáticamente', requirement, requiresCutoffSnapshot };
}
