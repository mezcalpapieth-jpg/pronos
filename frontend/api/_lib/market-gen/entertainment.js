/**
 * Entertainment calendar generator (Mexico pop culture).
 *
 * Reads three admin-curated config arrays and emits one pending-market
 * spec per resolvable event within a near-term horizon. Covers:
 *   - Awards   (Latin Grammy, Premios Juventud, Premios Lo Nuestro …)
 *   - Reality  (La Casa de los Famosos weekly + season winner)
 *   - Concerts (Ticketmaster / promoter-announced, binary Sí/No)
 *
 * All markets produced here carry resolver_type=null — admin resolves
 * them manually. The generator stays silent (returns []) until admin
 * populates the config files.
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

// Only generate markets for events that resolve within this many days.
// Prevents the queue from filling with events months ahead — admin can
// always approve earlier by populating closer to the date.
const HORIZON_DAYS = 60;

function withinHorizon(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  if (t <= now) return false;                         // past = skip
  return t - now <= HORIZON_DAYS * 86_400_000;
}

// ─── Awards ─────────────────────────────────────────────────────────────
function awardSpecs(award) {
  if (!withinHorizon(award.ceremonyDate)) return [];
  const specs = [];
  for (const cat of award.categories || []) {
    const nominees = Array.isArray(cat.nominees) ? cat.nominees.filter(Boolean) : [];
    if (nominees.length < 2) continue; // need at least 2 legs
    specs.push({
      source: 'entertainment',
      source_event_id: `award:${award.key}:${cat.key}`,
      question: `${cat.label} · ${award.label}`,
      category: 'musica',
      icon: '🏆',
      outcomes: [...nominees, 'Otro'],
      seed_liquidity: 1000,
      end_time: award.ceremonyDate,
      amm_mode: 'parallel',
      resolver_type: null,                // admin resolves after ceremony
      resolver_config: null,
      source_data: {
        kind: 'award',
        awardKey: award.key,
        awardLabel: award.label,
        categoryKey: cat.key,
        ceremonyDate: award.ceremonyDate,
      },
    });
  }
  return specs;
}

// ─── Reality shows ──────────────────────────────────────────────────────
function realityWeekSpec(ev) {
  if (!withinHorizon(ev.eliminationDate)) return null;
  const nominated = Array.isArray(ev.nominated) ? ev.nominated.filter(Boolean) : [];
  if (nominated.length < 2) return null;
  return {
    source: 'entertainment',
    source_event_id: `reality_week:${ev.key}`,
    question: `¿Quién sale de ${ev.showLabel} esta semana? (${ev.seasonLabel}, semana ${ev.weekNumber})`,
    category: 'musica',
    icon: '📺',
    outcomes: nominated,
    seed_liquidity: 1000,
    end_time: ev.eliminationDate,
    amm_mode: 'parallel',
    resolver_type: null,
    resolver_config: null,
    source_data: {
      kind: 'reality_week',
      showLabel: ev.showLabel,
      seasonLabel: ev.seasonLabel,
      weekNumber: ev.weekNumber,
    },
  };
}

function realityWinnerSpec(ev) {
  if (!withinHorizon(ev.finaleDate)) return null;
  const housemates = Array.isArray(ev.housemates) ? ev.housemates.filter(Boolean) : [];
  if (housemates.length < 2) return null;
  return {
    source: 'entertainment',
    source_event_id: `reality_winner:${ev.key}`,
    question: `¿Quién gana ${ev.showLabel} (${ev.seasonLabel})?`,
    category: 'musica',
    icon: '👑',
    outcomes: housemates,
    seed_liquidity: 1000,
    end_time: ev.finaleDate,
    amm_mode: 'parallel',
    resolver_type: null,
    resolver_config: null,
    source_data: {
      kind: 'reality_winner',
      showLabel: ev.showLabel,
      seasonLabel: ev.seasonLabel,
    },
  };
}

// ─── Concerts ───────────────────────────────────────────────────────────
function concertSpec(ev) {
  if (!withinHorizon(ev.resolveAt)) return null;
  if (typeof ev.question !== 'string' || ev.question.trim().length < 8) return null;
  return {
    source: 'entertainment',
    source_event_id: `concert:${ev.key}`,
    question: ev.question,
    category: ev.category || 'musica',
    icon: '🎤',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: ev.resolveAt,
    amm_mode: 'unified',
    resolver_type: null,
    resolver_config: null,
    source_data: {
      kind: 'concert',
      artist: ev.artist,
      venue: ev.venue,
    },
  };
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

  return specs;
}
