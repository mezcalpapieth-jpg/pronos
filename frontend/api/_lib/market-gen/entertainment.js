/**
 * Entertainment calendar generator (Mexico pop culture).
 *
 * Reads three admin-curated config arrays and emits one pending-market
 * spec per resolvable event within a near-term horizon. Covers:
 *   - Awards   (Latin Grammy, Premios Juventud, Premios Lo Nuestro …)
 *   - Reality  (La Casa de los Famosos weekly + season winner)
 *   - Concerts (Ticketmaster / promoter-announced, binary Sí/No)
 *
 * All markets produced here carry resolver_type=manual_review — the
 * scheduler wakes them at close and queues an admin resolution candidate
 * instead of auto-paying a fuzzy entertainment result.
 *
 * Idempotent per (source, source_event_id) — editing the config and
 * re-running refreshes any pending rows in place (same DO UPDATE
 * semantics as every other generator).
 */

import {
  AWARD_CEREMONIES,
  REALITY_EVENTS,
  CONCERT_EVENTS,
} from '../entertainment-config.js';
import { attachSuggestedPricing } from '../market-pricing.js';

// Only generate markets for events that resolve within this many days.
// Prevents the queue from filling with events months ahead — admin can
// always approve earlier by populating closer to the date.
const HORIZON_DAYS = 60;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

function aiPricingEnabled() {
  return process.env.ENTERTAINMENT_PRICING_AI_ENABLED === 'true'
    && Boolean(process.env.ANTHROPIC_API_KEY);
}

function manualReviewConfig({ sourceEventId, criteria, evidence = [] }) {
  return {
    source: 'manual-review',
    sourceEventId,
    criteria,
    evidence: Array.isArray(evidence) ? evidence : [],
  };
}

function withinHorizon(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  if (t <= now) return false;                         // past = skip
  return t - now <= HORIZON_DAYS * 86_400_000;
}

function configuredProbabilities(config = {}, outcomeCount, fallback) {
  const explicit = config.probabilities || config.probabilityPct || null;
  if (Array.isArray(explicit) && explicit.length === outcomeCount) return explicit;
  return fallback;
}

function awardProbabilities(outcomeCount) {
  if (outcomeCount < 2) return [];
  const otherShare = outcomeCount > 2 ? 0.08 : 0;
  const nomineeCount = outcomeCount - 1;
  return [
    ...Array.from({ length: nomineeCount }, () => (1 - otherShare) / nomineeCount),
    otherShare,
  ];
}

function uniformProbabilities(outcomeCount) {
  return Array.from({ length: outcomeCount }, () => 1 / outcomeCount);
}

function binaryProbabilitiesFromYes(value, fallback = 0.45) {
  const raw = Number(value ?? fallback);
  const yes = Number.isFinite(raw) ? (raw > 1 ? raw / 100 : raw) : fallback;
  return [yes, 1 - yes];
}

function normalizeTopicText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function awardTopic(award = {}, cat = {}) {
  const text = normalizeTopicText([
    award.key,
    award.label,
    cat.key,
    cat.label,
  ].filter(Boolean).join(' '));
  if (/(oscar|cine|pelicula|film|actor|actriz|director)/.test(text)) return 'cine';
  if (/(emmy|tv|television|serie|show|reality)/.test(text)) return 'tv';
  if (/(grammy|musica|musical|cancion|album|artista|juventud|lo nuestro|billboard)/.test(text)) return 'musica';
  return 'musica';
}

function withEntertainmentTopic(spec, topicTags) {
  const tags = Array.isArray(topicTags) ? topicTags.filter(Boolean) : [];
  return {
    ...spec,
    topic_tags: tags,
    source_data: {
      ...(spec.source_data || {}),
      categorization: {
        ...(spec.source_data?.categorization || {}),
        topicTags: tags,
      },
    },
  };
}

async function suggestPricingWithAnthropic(spec) {
  if (!aiPricingEnabled()) return null;
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  if (outcomes.length < 2 || outcomes.length > 12) return null;

  const prompt = `Sugiere probabilidades iniciales para este mercado de entretenimiento/farandula en Pronos. No resuelvas el mercado; solo estima odds de apertura revisables por admin.

Pregunta: ${spec.question}
Opciones: ${JSON.stringify(outcomes)}
Contexto: ${JSON.stringify({
    sourceData: spec.source_data || {},
    resolverEvidence: spec.resolver_config?.evidence || [],
    currentSuggestion: spec.source_data?.suggestedPricing || null,
  })}

Reglas:
- Devuelve probabilidades conservadoras, no certeza.
- Las probabilidades deben sumar 100.
- Usa solamente numeros, sin simbolo %.
- Si no hay evidencia fuerte, quedate cerca de balanceado.

Responde SOLO JSON valido:
{"probabilities":[50,50],"rationale":"explicacion breve en espanol"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.warn('[market-gen/entertainment] AI pricing HTTP', res.status);
      return null;
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const probabilities = Array.isArray(parsed.probabilities) ? parsed.probabilities : null;
    if (!probabilities || probabilities.length !== outcomes.length) return null;
    return {
      probabilities,
      source: 'anthropic-pricing',
      rationale: parsed.rationale || 'Estimación AI conservadora para revisión admin.',
      evidence: [
        ...(spec.source_data?.suggestedPricing?.evidence || []),
        { title: 'Anthropic pricing model', model: ANTHROPIC_MODEL },
      ],
    };
  } catch (e) {
    console.warn('[market-gen/entertainment] AI pricing failed', { message: e?.message });
    return null;
  }
}

async function maybeAttachAiPricing(spec) {
  const aiPricing = await suggestPricingWithAnthropic(spec);
  return aiPricing ? attachSuggestedPricing(spec, aiPricing) : spec;
}

// ─── Awards ─────────────────────────────────────────────────────────────
function awardSpecs(award) {
  if (!withinHorizon(award.ceremonyDate)) return [];
  const specs = [];
  for (const cat of award.categories || []) {
    const nominees = Array.isArray(cat.nominees) ? cat.nominees.filter(Boolean) : [];
    if (nominees.length < 2) continue; // need at least 2 legs
    const outcomes = [...nominees, 'Otro'];
    const spec = {
      source: 'entertainment',
      source_event_id: `award:${award.key}:${cat.key}`,
      question: `${cat.label} · ${award.label}`,
      category: 'musica',
      icon: null,
      outcomes,
      seed_liquidity: 1000,
      end_time: award.ceremonyDate,
      amm_mode: 'parallel',
      resolver_type: 'manual_review',
      resolver_config: manualReviewConfig({
        sourceEventId: `award:${award.key}:${cat.key}`,
        criteria: 'Confirmar ganador oficial después de la ceremonia.',
        evidence: award.sources || award.evidence || [],
      }),
      source_data: {
        kind: 'award',
        awardKey: award.key,
        awardLabel: award.label,
        categoryKey: cat.key,
        ceremonyDate: award.ceremonyDate,
      },
    };
    specs.push(attachSuggestedPricing(withEntertainmentTopic(spec, [awardTopic(award, cat)]), {
      probabilities: configuredProbabilities(cat, outcomes.length, awardProbabilities(outcomes.length)),
      source: Array.isArray(cat.probabilities) || Array.isArray(cat.probabilityPct)
        ? 'admin-config'
        : 'source-signals:award-nominees',
      rationale: 'Nominados balanceados con una reserva menor para Otro; admin puede editar antes de aprobar.',
      evidence: award.sources || award.evidence || [],
    }));
  }
  return specs;
}

// ─── Reality shows ──────────────────────────────────────────────────────
function realityWeekSpec(ev) {
  if (!withinHorizon(ev.eliminationDate)) return null;
  const nominated = Array.isArray(ev.nominated) ? ev.nominated.filter(Boolean) : [];
  if (nominated.length < 2) return null;
  const spec = {
    source: 'entertainment',
    source_event_id: `reality_week:${ev.key}`,
    question: `¿Quién sale de ${ev.showLabel} esta semana? (${ev.seasonLabel}, semana ${ev.weekNumber})`,
    category: 'musica',
    icon: null,
    outcomes: nominated,
    seed_liquidity: 1000,
    end_time: ev.eliminationDate,
    amm_mode: 'parallel',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `reality_week:${ev.key}`,
      criteria: 'Confirmar expulsado oficial después de la transmisión.',
      evidence: ev.sources || ev.evidence || [],
    }),
    source_data: {
      kind: 'reality_week',
      showLabel: ev.showLabel,
      seasonLabel: ev.seasonLabel,
      weekNumber: ev.weekNumber,
    },
  };
  return attachSuggestedPricing(withEntertainmentTopic(spec, ['tv', 'farandula']), {
    probabilities: configuredProbabilities(ev, nominated.length, uniformProbabilities(nominated.length)),
    source: Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct)
      ? 'admin-config'
      : 'source-signals:reality-nominees',
    rationale: 'Nominados balanceados hasta que haya señales más fuertes de audiencia/votación.',
    evidence: ev.sources || ev.evidence || [],
  });
}

function realityWinnerSpec(ev) {
  if (!withinHorizon(ev.finaleDate)) return null;
  const housemates = Array.isArray(ev.housemates) ? ev.housemates.filter(Boolean) : [];
  if (housemates.length < 2) return null;
  const spec = {
    source: 'entertainment',
    source_event_id: `reality_winner:${ev.key}`,
    question: `¿Quién gana ${ev.showLabel} (${ev.seasonLabel})?`,
    category: 'musica',
    icon: null,
    outcomes: housemates,
    seed_liquidity: 1000,
    end_time: ev.finaleDate,
    amm_mode: 'parallel',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `reality_winner:${ev.key}`,
      criteria: 'Confirmar ganador oficial después de la final.',
      evidence: ev.sources || ev.evidence || [],
    }),
    source_data: {
      kind: 'reality_winner',
      showLabel: ev.showLabel,
      seasonLabel: ev.seasonLabel,
    },
  };
  return attachSuggestedPricing(withEntertainmentTopic(spec, ['tv', 'farandula']), {
    probabilities: configuredProbabilities(ev, housemates.length, uniformProbabilities(housemates.length)),
    source: Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct)
      ? 'admin-config'
      : 'source-signals:reality-cast',
    rationale: 'Cast balanceado hasta que haya señales más fuertes de audiencia/votación.',
    evidence: ev.sources || ev.evidence || [],
  });
}

// ─── Concerts ───────────────────────────────────────────────────────────
function concertSpec(ev) {
  if (!withinHorizon(ev.resolveAt)) return null;
  if (typeof ev.question !== 'string' || ev.question.trim().length < 8) return null;
  const spec = {
    source: 'entertainment',
    source_event_id: `concert:${ev.key}`,
    question: ev.question,
    category: ev.category || 'musica',
    icon: null,
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: ev.resolveAt,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `concert:${ev.key}`,
      criteria: 'Confirmar anuncio oficial, venta publicada o comunicado del promotor.',
      evidence: ev.sources || ev.evidence || [],
    }),
    source_data: {
      kind: 'concert',
      artist: ev.artist,
      venue: ev.venue,
    },
  };
  return attachSuggestedPricing(withEntertainmentTopic(spec, ['musica']), {
    probabilities: configuredProbabilities(
      ev,
      2,
      binaryProbabilitiesFromYes(ev.probabilityYes ?? ev.suggestedProbabilityYes),
    ),
    source: Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct) || ev.probabilityYes != null
      ? 'admin-config'
      : 'source-signals:concert',
    rationale: 'Señal inicial para anuncio/venta; admin puede editar la liquidez antes de aprobar.',
    evidence: ev.sources || ev.evidence || [],
  });
}

export async function generateEntertainmentMarkets() {
  const specs = [];

  for (const award of AWARD_CEREMONIES) {
    specs.push(...awardSpecs(award));
  }
  for (const ev of REALITY_EVENTS) {
    if (ev.kind === 'reality_week') {
      const s = realityWeekSpec(ev);
      if (s) specs.push(s);
    } else if (ev.kind === 'reality_winner') {
      const s = realityWinnerSpec(ev);
      if (s) specs.push(s);
    }
  }
  for (const ev of CONCERT_EVENTS) {
    const s = concertSpec(ev);
    if (s) specs.push(s);
  }

  const out = [];
  for (const spec of specs) out.push(await maybeAttachAiPricing(spec));
  return out;
}

export const _internal = {
  aiPricingEnabled,
  awardProbabilities,
  binaryProbabilitiesFromYes,
  configuredProbabilities,
  suggestPricingWithAnthropic,
  uniformProbabilities,
};
