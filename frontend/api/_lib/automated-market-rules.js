export const RULES_VERSION = 'official-contracts-2026-10-15-v1';
export const RT_URL = 'https://www.rottentomatoes.com/m/street_fighter_2026';
export const RT_THRESHOLD_KIND = 'rotten-tomatoes-threshold-cutoff';
// Only verified movie identities may be used by the threshold collector.
export const RT_THRESHOLD_FILMS = {
  'you-can-see-everything-2026': {
    url: 'https://www.rottentomatoes.com/m/you_can_see_everything',
    title: 'You Can See Everything', year: 2026, directors: ['Nathan Fielder', 'Lance Oppenheim'],
  },
};
export const AA_URL = 'https://artificialanalysis.ai/leaderboards/models';
export const AA_METHODOLOGY_URL = 'https://artificialanalysis.ai/methodology/intelligence-benchmarking';
export const GDP_OUTCOMES = ['< 0.5%', '0.5% a 1.0%', '1.0% a 1.5%', '1.5% a 2.0%', '2.0% a 2.5%', '2.5% a 3.0%', '3.0% a 3.5%', '3.5% o más'];
export const RT_OUTCOMES = ['45 o menos', '46 a 50', '51 a 55', '56 a 60', '61 a 65', '66 a 70', '71 a 75', '76 a 80', '81 a 85', '86 a 90', '91 o más'];
export const AA_OUTCOMES = ['OpenAI', 'Google', 'Anthropic', 'xAI', 'Meta', 'Otro'];

export function automatedRules(kind, { cutoff, targetPeriod = '2026-Q3', film, threshold } = {}) {
  const date = cutoff ? new Date(cutoff).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) : '';
  const movie = Object.hasOwn(RT_THRESHOLD_FILMS, film || '') ? RT_THRESHOLD_FILMS[film] : null;
  if (kind === RT_THRESHOLD_KIND && (!movie || !Number.isInteger(threshold) || threshold < 0 || threshold >= 100)) {
    throw new Error('invalid_rt_threshold_contract');
  }
  const commonEs = 'Si faltan pruebas verificables o hay datos contradictorios, pasa a revisión manual; no se estima el resultado.';
  const commonEn = 'Missing verifiable evidence or conflicting data requires manual review; the result is never estimated.';
  const rules = {
    'inegi-gdp-first-release': [
      `Se usa el PIB Total de ${targetPeriod}, variación porcentual real anual de la serie original (sin ajuste estacional), en la primera Estimación Oportuna del PIB Trimestral publicada por INEGI. Se lee el cuadro de cifras originales del boletín oficial, incluido su documento Word oficial equivalente. No cuentan la variación trimestral, el acumulado anual, las cifras desestacionalizadas ni revisiones posteriores. Se usa el dato publicado sin redondeo adicional. Los rangos incluyen el límite inferior y excluyen el superior; 1.0% pertenece a 1.0% a 1.5%. Si INEGI retrasa el comunicado, el mercado permanece cerrado y espera su publicación. ${commonEs}`,
      `Use Total GDP for ${targetPeriod}, original-series real year-over-year percentage change (not seasonally adjusted), from INEGI's first Timely Estimate of Quarterly GDP release. Read the original-series table in the official bulletin, including its equivalent official Word document. Quarterly changes, cumulative growth, seasonally adjusted figures and later revisions do not count. Use the published value without extra rounding. Lower bounds are inclusive and upper bounds exclusive; 1.0% belongs to 1.0% to 1.5%. A delayed release keeps the market closed until publication. ${commonEn}`,
    ],
    'openai-astra-release': [
      `Gana Sí si OpenAI anuncia oficialmente y hace públicamente accesible un nuevo modelo de la familia GPT Astra, versión 6.1 o superior, a más tardar el ${date} a las 23:59:59 CDMX. Cuentan ChatGPT o la API de OpenAI, suscripciones de pago y previews públicas de autoservicio sin invitación ni lista de espera. GPT-6.1 Sol, GPT-6 Astra, renombres de modelos existentes, anuncios de acceso futuro, pruebas privadas y benchmarks sin acceso público no cuentan. Un sucesor de nombre ambiguo requiere revisión manual. Se archivan anuncios oficiales y documentación de acceso. No solo puede ganar tras revisar todos los anuncios oficiales del periodo y las notas de ChatGPT y documentación de modelos al cierre; se exige una captura completa de los últimos 60 segundos antes del límite. Un error de la fuente nunca equivale a No. ${commonEs}`,
      `Yes wins if OpenAI officially announces and publicly releases a new GPT Astra-family model, version 6.1 or higher, by ${date} at 23:59:59 Mexico City time. ChatGPT or the OpenAI API, paid subscriptions and self-service public previews without invitations or waitlists count. GPT-6.1 Sol, GPT-6 Astra, existing-model renames, future-access announcements, private tests and benchmarks without public access do not count. Ambiguously named successors require manual review. Archive official announcements and access documentation. No requires checking all official announcements in the period plus ChatGPT release notes and model documentation at close, with a complete capture from the final 60 seconds before the deadline. A source failure never means No. ${commonEn}`,
    ],
    'rotten-tomatoes-cutoff': [
      `Se usa exclusivamente el porcentaje entero All Critics Tomatometer de ${RT_URL} al ${date} a las 08:00:00 CDMX. No cuentan Top Critics, Popcornmeter ni la nota media sobre 10. Se usa la última captura verificada completada antes o exactamente al límite, con antigüedad máxima de 60 segundos; cambios posteriores se ignoran. Los rangos son enteros: 45 o menos, 46 a 50, y así sucesivamente hasta 91 o más. Si la página válida confirma que no hay Tomatometer publicado, se anula mediante el procedimiento de cancelación y devolución de costo pendiente. Una página bloqueada, incompleta o sin captura válida exige revisión manual, nunca un score de cero. ${commonEs}`,
      `Use only the integer All Critics Tomatometer percentage at ${RT_URL} on ${date} at 08:00:00 Mexico City time. Top Critics, Popcornmeter and average ratings out of 10 do not count. Use the last verified capture completed at or before the deadline, at most 60 seconds old; ignore later changes. Integer ranges are 45 or lower, 46 to 50, continuing through 91 or higher. A valid page explicitly showing no Tomatometer triggers cancellation and refund of remaining cost basis. Blocked or incomplete pages, or missing valid captures, require manual review, never a zero score. ${commonEn}`,
    ],
    [RT_THRESHOLD_KIND]: [
      `Gana Sí si el porcentaje entero All Critics Tomatometer de ${movie?.title} (${movie?.url}) es estrictamente mayor que ${threshold}% al ${date} a las 23:59:00 CDMX; ${threshold}% o menos corresponde a No. Se evalúa únicamente el score al cierre, no su trayectoria durante la semana. No cuentan Top Critics, Popcornmeter ni la nota media sobre 10. Se usa la última captura verificada completada antes o exactamente al límite, con antigüedad máxima de 60 segundos; cambios posteriores se ignoran. Si la página válida confirma que no hay Tomatometer publicado, se anula y devuelve el costo pendiente. Una página bloqueada, incompleta o sin captura válida exige revisión manual, nunca un score de cero. ${commonEs}`,
      `Yes wins if the integer All Critics Tomatometer percentage for ${movie?.title} (${movie?.url}) is strictly above ${threshold}% on ${date} at 23:59:00 Mexico City time; ${threshold}% or lower means No. Only the closing score counts, not its path during the week. Top Critics, Popcornmeter and average ratings out of 10 do not count. Use the last verified capture completed at or before the deadline, at most 60 seconds old; ignore later changes. A valid page explicitly showing no Tomatometer triggers cancellation and refund of remaining cost basis. Blocked or incomplete pages, or missing valid captures, require manual review, never a zero score. ${commonEn}`,
    ],
    'artificial-analysis-cutoff': [
      `Se usa la tabla pública completa y sin filtros de modelos de texto del Artificial Analysis Intelligence Index (${AA_URL}), ordenada de mayor a menor índice, al ${date} a las 23:59:59 CDMX. Se respeta el score visible y, en empate de score visible, el orden oficial visible de la tabla, no el orden de una API ni decimales ocultos. Cada configuración de razonamiento cuenta como aparece listada. Gana el laboratorio creador del modelo líder; un laboratorio no listado corresponde a Otro. Se conserva la versión principal vigente del índice y su metodología, sin mezclar versiones. Se usa la última captura completa anterior o igual al límite con antigüedad máxima de cinco minutos. Una tabla incompleta, empate sin orden verificable o discrepancia de fuentes exige revisión manual. ${commonEs}`,
      `Use the complete, unfiltered public text-model Artificial Analysis Intelligence Index table (${AA_URL}), sorted by descending index, on ${date} at 23:59:59 Mexico City time. Use visible scores and official visible table order for tied visible scores, never API ordering or hidden precision. Each listed reasoning configuration counts separately. The leading model's creator lab wins; an unlisted creator maps to Other. Preserve the current primary index version and methodology without mixing versions. Use the last complete capture at or before the deadline, at most five minutes old. Incomplete tables, unverifiable tie order or conflicting sources require manual review. ${commonEn}`,
    ],
  };
  if (!rules[kind]) throw new Error('unsupported_automated_rules');
  return { criteria: rules[kind][0], criteriaEn: rules[kind][1] };
}

export function automaticConfig(kind, { cutoff, resolveAt = cutoff, targetPeriod, openedAt, film, threshold } = {}) {
  return { source: 'official-result', kind, rulesVersion: RULES_VERSION,
    ...automatedRules(kind, { cutoff, targetPeriod, film, threshold }),
    ...(kind === RT_THRESHOLD_KIND ? { film, threshold } : {}),
    ...(cutoff ? { cutoff } : {}), ...(targetPeriod ? { targetPeriod } : {}),
    ...(openedAt ? { openedAt } : {}), resolveAt };
}

export function isAutomaticContract(cfg) {
  if (cfg?.source !== 'official-result' || cfg.rulesVersion !== RULES_VERSION || !Number.isFinite(Date.parse(cfg.resolveAt))) return false;
  if (cfg.kind === 'inegi-gdp-first-release') {
    if (!/^20\d{2}-Q[1-4]$/.test(cfg.targetPeriod)) return false;
  } else {
    if (!Number.isFinite(Date.parse(cfg.cutoff))) return false;
    const cutoff = new Date(cfg.cutoff);
    const expectedTime = cfg.kind === 'rotten-tomatoes-cutoff' ? '08:00:00' : cfg.kind === RT_THRESHOLD_KIND ? '23:59:00' : '23:59:59';
    if (cutoff.getUTCMilliseconds() !== 0 || cutoff.toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour12: false }) !== expectedTime) return false;
  }
  if (cfg.kind === RT_THRESHOLD_KIND && Date.parse(cfg.resolveAt) < Date.parse(cfg.cutoff)) return false;
  if (cfg.kind === 'openai-astra-release' && (!Number.isFinite(Date.parse(cfg.openedAt)) || Date.parse(cfg.openedAt) > Date.parse(cfg.cutoff))) return false;
  try {
    const rules = automatedRules(cfg.kind, cfg);
    return cfg.criteria === rules.criteria && cfg.criteriaEn === rules.criteriaEn;
  } catch { return false; }
}

export function applyAutomaticContract(spec, config) {
  return { ...spec, resolver_type: 'api_chart', resolver_config: { ...spec.resolver_config, ...config },
    source_data: { ...spec.source_data, resolutionCriteria: config.criteria,
      resolutionCriteriaEn: config.criteriaEn, rulesVersion: config.rulesVersion,
      ...(config.cutoff ? { closesAt: config.cutoff, snapshotAt: config.cutoff } : {}) } };
}
