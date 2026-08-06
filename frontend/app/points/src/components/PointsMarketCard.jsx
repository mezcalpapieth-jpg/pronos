/**
 * Market card for the points-app grid.
 *
 * Layout: question + a row per outcome showing current probability and
 * the projected payout on a 100 MXNP investment. NO sparkline — charts
 * only appear on the detail page, per product feedback (cards should
 * focus on the trade signal, not the chart).
 *
 * Projected payout calculation (simple, ignores fee + slippage):
 *   shares ≈ stake / price        (if you buy at current price)
 *   payout ≈ shares MXNP          (1 MXNP per winning share)
 *   net gain ≈ shares − stake
 * We show the net gain as "+X MXNP si ganas" — easy mental math.
 *
 * Props:
 *   market       — row from /api/points/markets
 *   userPosition — optional { outcomeIndex, shares } for the signed-in
 *                  user in this market. When present, a "Tu posición"
 *                  badge renders at the top of the card.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CHAMPIONS_LEAGUE_FINAL_BADGE,
  CHAMPIONS_LEAGUE_HUB_PATH,
  isChampionsLeagueFinalWinnerMarket,
} from '@app/lib/championsLeague.js';
import { useT } from '@app/lib/i18n.js';
import { findTeamByName, teamProfilePath } from '@app/lib/teamProfiles.js';
import { marketInterestPayload, teamInterestPayload, trackInterest } from '@app/lib/interest.js';
import PointsBuyModal from './PointsBuyModal.jsx';

const STAKE_PREVIEW = 100; // MXNP reference stake for the card payout preview

function formatDeadline(endTime) {
  if (!endTime) return '';
  const d = new Date(endTime);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function formatVolume(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

// Very rough gain estimate: at price p, 100 MXNP buys ~100/p shares,
// which pay out 100/p MXNP if the outcome wins. Net = 100/p − 100.
// Ignores fees and price impact on purpose — cards are preview text,
// the precise quote is computed on-server when the user actually buys.
function previewGain(price) {
  const p = Math.max(0.01, Math.min(0.99, Number(price) || 0.5));
  const payout = STAKE_PREVIEW / p;
  return Math.round(payout - STAKE_PREVIEW);
}

export default function PointsMarketCard({ market, userPosition }) {
  const navigate = useNavigate();
  const t = useT();
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));
  // Optional per-outcome image (team crest / player portrait) coming
  // from the generator pipeline. Sparse array: indices without a logo
  // hold null (e.g. draw on a 3-way soccer market). Non-sports markets
  // leave the whole field null.
  const outcomeImages = Array.isArray(market.outcomeImages)
    && market.outcomeImages.length === outcomes.length
    ? market.outcomeImages
    : null;
  const outcomeCountryLabels = Array.isArray(market.outcomeCountryLabels)
    && market.outcomeCountryLabels.length === outcomes.length
    ? market.outcomeCountryLabels
    : null;
  const hasAnyLogo = outcomeImages?.some(Boolean) || false;

  // Drawer state — when set, render PointsBuyModal in variant="drawer"
  // pre-selected on this outcome. Clicking an outcome row stops event
  // propagation so the card doesn't also navigate to the detail page.
  const [drawerIndex, setDrawerIndex] = useState(null);
  const drawerOpen = drawerIndex !== null;

  const isResolved = market.status === 'resolved';
  const isSeriesPending = !isResolved && (market.seriesLocked || market.status === 'pending');
  // Parallel parent markets have no per-parent pool — buys go against
  // individual legs. /api/points/markets now exposes legIds (one leg
  // per outcome, same order as `outcomes`), so the drawer can target
  // the right leg directly. If legIds is missing (older response /
  // schema mismatch) fall back to navigating into the detail page.
  const parallelLegs = market.ammMode === 'parallel' && Array.isArray(market.legIds)
    && market.legIds.length === outcomes.length
    ? market.legIds
    : null;
  const canOpenDrawer = !isResolved
    && !isSeriesPending
    && market.status === 'active'
    && (market.ammMode !== 'parallel' || parallelLegs !== null);
  // isLive: only true for fixed-window sports events. The API
  // (/api/points/markets) computes this with two defenses — excludes
  // resolver_config.source='next-opponent' and rejects windows longer
  // than 14 days — so we trust market.live and skip the client-side
  // recompute. Falling back to the date check for older API responses
  // that don't carry the field. Don't recompute for open-ended
  // predictions like ¿Contra quién pelea Canelo? which used to flash
  // EN VIVO for their entire 180-day window.
  const now = new Date();
  const isLive = typeof market.live === 'boolean'
    ? (!isResolved && market.live)
    : (
        !isResolved
        && market.status === 'active'
        && market.startTime
        && new Date(market.startTime) <= now
        && (!market.endTime || new Date(market.endTime) > now)
      );
  const isPending = !isResolved
    && !isLive
    && market.status === 'active'
    && market.endTime
    && new Date(market.endTime) < now;
  const isChampionsFinalCard = isChampionsLeagueFinalWinnerMarket(market);
  const marketDetailPath = `/market?id=${encodeURIComponent(market.id)}`;
  const cardTargetPath = isChampionsFinalCard ? CHAMPIONS_LEAGUE_HUB_PATH : marketDetailPath;
  const navigateToCardTarget = () => {
    trackInterest({
      ...marketInterestPayload('points', market, 'click'),
      objectType: 'points_market',
    });
    navigate(cardTargetPath);
  };
  const volume = market.volume ?? market.tradeVolume ?? 0;

  function navigateToTeam(e, team) {
    if (!team) return;
    e.stopPropagation();
    trackInterest({
      ...teamInterestPayload('points', team, 'click'),
      objectType: 'team',
    });
    navigate(teamProfilePath(team));
  }

  // Card palette is restricted to three hue families — green, yellow,
  // red — with three shades each. Ordered so adjacent indices always
  // land on a different hue (med-G, med-Y, med-R, light-G, light-Y,
  // light-R, dark-G, dark-Y, dark-R). Detail-page buy buttons keep
  // their wider 8-color palette; this is card-only per product
  // feedback (traffic-light feel, no blues/purples bleeding in).
  const ACCENTS = [
    // Medium row — also the W/D/L default for 3-outcome markets.
    { bg: 'var(--yes-dim)', border: 'rgba(22,163,74,0.25)', fg: 'var(--yes)' },            // green-medium
    { bg: 'rgba(245,158,11,0.1)',                border: 'rgba(245,158,11,0.3)',  fg: 'var(--gold)' }, // gold (yellow-medium)
    { bg: 'rgba(255,59,59,0.08)',                border: 'rgba(255,59,59,0.3)',   fg: '#ff3b3b' },              // red-medium
    // Light row
    { bg: 'rgba(74,222,128,0.1)',                border: 'rgba(74,222,128,0.3)',  fg: '#4ade80' },              // green-light
    { bg: 'rgba(253,224,71,0.1)',                border: 'rgba(253,224,71,0.35)', fg: '#fde047' },              // yellow-light
    { bg: 'rgba(248,113,113,0.1)',               border: 'rgba(248,113,113,0.3)', fg: '#f87171' },              // red-light (salmon)
    // Dark row
    { bg: 'rgba(21,128,61,0.12)',                border: 'rgba(21,128,61,0.4)',   fg: '#16a34a' },              // green-dark
    { bg: 'rgba(161,98,7,0.12)',                 border: 'rgba(161,98,7,0.4)',    fg: '#b45309' },              // yellow-dark (amber)
    { bg: 'rgba(185,28,28,0.12)',                border: 'rgba(185,28,28,0.4)',   fg: '#dc2626' },              // red-dark (burgundy)
  ];
  const accentFor = (i) => {
    // Binary: canonical green / red pair.
    if (outcomes.length === 2) return i === 0 ? ACCENTS[0] : ACCENTS[2];
    // 3-outcome W/D/L: green / gold / red (traffic light).
    if (outcomes.length === 3) return ACCENTS[i];
    // N > 3: cycle the 9 shades modulo. Each "row" of 3 is one hue family;
    // cycling keeps adjacent outcomes on different hues.
    return ACCENTS[i % ACCENTS.length];
  };

  return (
    <div
      className="mock-card"
      onClick={navigateToCardTarget}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigateToCardTarget();
      }}
    >
      <div className="mock-card-header">
        <span className="mock-card-cat">
          {market.category || 'General'}
        </span>
        {isResolved && (
          <span className="mock-card-badge live" style={{ background: 'rgba(0,232,122,0.12)', color: 'var(--green)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {t('points.card.resolved')}
          </span>
        )}
        {isLive && (
          <span className="mock-card-badge" style={{
            background: 'rgba(220,38,38,0.18)',
            color: 'var(--danger)',
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.08em',
            animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
          }}>
            {t('points.card.live')}
          </span>
        )}
        {isChampionsFinalCard && (
          <span
            className="mock-card-badge"
            aria-label="Final Champions League"
            title="Final Champions League"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 28,
              background: 'rgba(59,130,246,0.14)',
              border: '1px solid rgba(245,200,66,0.45)',
              color: 'var(--gold)',
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            {CHAMPIONS_LEAGUE_FINAL_BADGE}
          </span>
        )}
        {isPending && !isResolved && !isLive && (
          <span className="mock-card-badge" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {t('points.card.pending')}
          </span>
        )}
        {isSeriesPending && !isResolved && !isLive && (
          <span className="mock-card-badge" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {t('points.series.pending')}
          </span>
        )}
        {userPosition && userPosition.shares > 0 && (
          <span style={{
            background: 'rgba(0,232,122,0.12)',
            color: 'var(--green)',
            padding: '2px 8px',
            borderRadius: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {t('points.card.yourPos')}
          </span>
        )}
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{market.question}</p>
        {market.seriesMeta?.subtitle && (
          <div style={{
            marginTop: -2,
            marginBottom: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {market.seriesMeta.subtitle}
          </div>
        )}

        {/* Single-column list of wide rows — logo + label on the left,
            a clickable +gain/% pill on the right. When the market has
            more than 4 outcomes (F1 with 21 drivers, election with 5
            candidates, …) we cap the list height and let the user
            scroll through every option inside the card instead of
            overflowing into a 2×2 grid with a "+N more" hint. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            margin: '10px 0 4px',
            ...(outcomes.length > 4 ? {
              maxHeight: 200,
              overflowY: 'auto',
              paddingRight: 4,
              WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
              maskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
            } : null),
          }}
          // Stop clicks inside the scroll area from bubbling up to
          // the outer card's navigate handler so the user can scroll
          // without accidentally opening the detail page.
          onClick={(e) => {
            if (outcomes.length > 4) e.stopPropagation();
          }}
        >
          {outcomes.map((label, i) => {
            const accent = accentFor(i);
            // Resolved markets collapse to a binary 100 / 0 display so
            // the card matches what the detail page already does — no
            // more stale "Bad Bunny 67%" showing after Bad Bunny won.
            const livePrice = prices[i];
            const resolvedPrice = isResolved ? (Number(market.outcome) === i ? 1 : 0) : null;
            const pct = Math.round((resolvedPrice ?? livePrice) * 100);
            const gain = previewGain(livePrice);
            const logo = outcomeImages?.[i] || null;
            const countryLabel = outcomeCountryLabels?.[i] || null;
            const teamProfile = findTeamByName(market.sport, label);
            const rowOnClick = (e) => {
              // Stop the click from reaching the card's outer
              // navigate handler so we can open the drawer in place.
              e.stopPropagation();
              if (canOpenDrawer) setDrawerIndex(i);
              else navigateToCardTarget();
            };
            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={rowOnClick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rowOnClick(e); }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 6px 6px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Logo column. Reserve a 26px slot even when this
                    outcome has no image (e.g. 'Empate' on a 3-way
                    soccer row) so every label lines up at the same
                    x-offset as rows that do have a crest. */}
                {logo ? (
                  <img
                    src={logo}
                    alt=""
                    style={{
                      width: 26,
                      height: 26,
                      objectFit: 'contain',
                      flexShrink: 0,
                    }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : hasAnyLogo ? (
                  <span style={{ width: 26, height: 26, flexShrink: 0 }} aria-hidden="true" />
                ) : null}
                <span
                  role={teamProfile ? 'link' : undefined}
                  tabIndex={teamProfile ? 0 : undefined}
                  onClick={(e) => navigateToTeam(e, teamProfile)}
                  onKeyDown={(e) => {
                    if (!teamProfile) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigateToTeam(e, teamProfile);
                    }
                  }}
                  style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: teamProfile ? 'pointer' : 'inherit',
                }}>
                  {label}
                </span>
                {countryLabel && (
                  <span style={{
                    maxWidth: 90,
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
                    {countryLabel}
                  </span>
                )}
                {/* Accent pill — visual cue that this row is the buy
                    target. The whole row is clickable; the pill just
                    gives users something to aim at. */}
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: accent.bg,
                  border: `1px solid ${accent.border}`,
                  borderRadius: 100,
                  flexShrink: 0,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    +{gain}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    color: accent.fg,
                    minWidth: 32,
                    textAlign: 'right',
                  }}>
                    {pct}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Final score strip — only for resolved markets that have the
          score populated. Sits between the outcome rows and the
          volume / deadline footer so it reads like a result line at the
          bottom of a match card. */}
      {isResolved && market.finalScore && (
        <div style={{
          margin: '2px 0 8px',
          padding: '6px 10px',
          borderRadius: 8,
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>FINAL</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{market.finalScore}</span>
        </div>
      )}

      <div className="mock-card-footer">
        <span className="mock-card-vol">
          VOL <span>{formatVolume(volume)} MXNP</span>
        </span>
        <span className="mock-card-deadline">
          {formatDeadline(market.endTime)}
        </span>
      </div>

      {/* Buy drawer — rendered via createPortal to document.body by
          the modal component, so ancestor transforms on the card
          don't pin it to the card's containing block.
          For parallel parents, the actual pool lives on the leg, so
          we hand the modal a synthetic per-leg market shape: id =
          legIds[drawerIndex], outcomes = ['Sí','No'], outcomeIndex = 0
          (= bet YES on the chosen contender). The label keeps the
          parent outcome name so users see who they're betting on. */}
      {drawerOpen && canOpenDrawer && (
        <PointsBuyModal
          open={drawerOpen}
          variant="drawer"
          market={parallelLegs
            ? {
                ...market,
                id: parallelLegs[drawerIndex],
                ammMode: 'unified',
                outcomes: ['Sí', 'No'],
                outcomeImages: null,
                // Display fields stay in sync with the chosen leg's
                // YES price so the modal's quote ticker isn't off.
                prices: [market.prices?.[drawerIndex] ?? 0.5, 1 - (market.prices?.[drawerIndex] ?? 0.5)],
              }
            : market}
          outcomeIndex={parallelLegs ? 0 : drawerIndex}
          outcomeLabel={outcomes[drawerIndex]}
          onClose={() => setDrawerIndex(null)}
          onSuccess={() => setDrawerIndex(null)}
        />
      )}
    </div>
  );
}
