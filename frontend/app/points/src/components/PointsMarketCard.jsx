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
import { Check } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { localizedOutcomeLabels, localizedTitle, useLang, useT } from '@app/lib/i18n.js';
import { findTeamByName, teamProfilePath } from '@app/lib/teamProfiles.js';
import { marketInterestPayload, teamInterestPayload, trackInterest } from '@app/lib/interest.js';
import { soccerMatchTypeLabel } from '@app/lib/soccerMarketType.js';
import { pointsPublicAssetSrc } from '@app/lib/publicAssets.js';
import { AICM_HUB_PATH, isAicmDelayMarket } from '../lib/aicmMarkets.js';
import { marketArtworkHidden, marketImageSrc, marketPlaceholderImageSrc } from '../lib/marketImages.js';
import { isClosingSoonNonSportsMarket, isLiveSportsMarket } from '../lib/marketStatus.js';
import PointsBuyModal from './PointsBuyModal.jsx';
import CardLiveScore from './CardLiveScore.jsx';
import { PointsBookmark } from './PointsWatchlist.jsx';
import './points-browse.css';
import { useCardLiveScore } from '../lib/useCardLiveScore.js';

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

function marketCategoryLabel(category, t) {
  const slug = String(category ?? '').trim().toLowerCase();
  const key = `points.cat.${slug === 'world-cup' || slug === 'nuevos-mercados' ? 'worldCup' : slug}`;
  const label = t(key);
  return label === key ? t('points.topic.general') : label;
}

function displayedMarketVolume(market) {
  const seed = Number(market?.volume || 0);
  const traded = Number(market?.tradeVolume || 0);
  return seed + traded;
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

function outcomeInitials(label) {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] || '?';
  const second = words.length > 1 ? words[words.length - 1]?.[0] : '';
  return `${first}${second}`.toUpperCase();
}

function OutcomeLogo({ src, label }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'inline-grid',
          placeItems: 'center',
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
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
        width: 26,
        height: 26,
        objectFit: 'contain',
        flexShrink: 0,
      }}
      onError={() => setFailed(true)}
    />
  );
}

function MarketThumbnail({ market }) {
  // The presentation demo shows markets with no artwork at all.
  if (marketArtworkHidden()) return null;
  const [usePlaceholder, setUsePlaceholder] = useState(false);
  const fallback = marketPlaceholderImageSrc(market);
  const src = usePlaceholder ? fallback : marketImageSrc(market);
  return (
    <img
      src={pointsPublicAssetSrc(src)}
      alt=""
      aria-hidden="true"
      style={{
        width: 46,
        height: 46,
        borderRadius: 'var(--points-radius-sm)',
        objectFit: 'cover',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        flex: '0 0 46px',
      }}
      onError={(event) => {
        if (!usePlaceholder && src !== fallback) {
          setUsePlaceholder(true);
          return;
        }
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

export default function PointsMarketCard({ market, userPosition }) {
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();
  const { ref: cardRef, score: cardScore } = useCardLiveScore(market);
  const rawOutcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const localizedOutcomes = localizedOutcomeLabels({ ...market, outcomes: rawOutcomes }, lang);
  const outcomes = localizedOutcomes.length === rawOutcomes.length ? localizedOutcomes : rawOutcomes;
  const marketTitle = localizedTitle(market, lang) || market.question || '';
  const prices = Array.isArray(market.prices) && market.prices.length === rawOutcomes.length
    ? market.prices
    : rawOutcomes.map((_, i) => (i === 0 ? 0.5 : 1 / rawOutcomes.length));
  // Optional per-outcome image (team crest / player portrait) coming
  // from the generator pipeline. Sparse array: indices without a logo
  // hold null (e.g. draw on a 3-way soccer market). Non-sports markets
  // leave the whole field null.
  const outcomeImages = Array.isArray(market.outcomeImages)
    && market.outcomeImages.length === rawOutcomes.length
    ? market.outcomeImages
    : null;
  const outcomeCountryLabels = Array.isArray(market.outcomeCountryLabels)
    && market.outcomeCountryLabels.length === rawOutcomes.length
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
    && market.legIds.length === rawOutcomes.length
    ? market.legIds
    : null;
  const legStatuses = market.ammMode === 'parallel' && Array.isArray(market.legStatuses)
    && market.legStatuses.length === rawOutcomes.length
    ? market.legStatuses
    : null;
  const legOutcomes = market.ammMode === 'parallel' && Array.isArray(market.legOutcomes)
    && market.legOutcomes.length === rawOutcomes.length
    ? market.legOutcomes
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
  const liveSportsMarket = isLiveSportsMarket(market);
  const isLive = typeof market.live === 'boolean'
    ? (!isResolved && liveSportsMarket && market.live)
    : (
        !isResolved
        && liveSportsMarket
        && market.status === 'active'
        && market.startTime
        && new Date(market.startTime) <= now
        && (!market.endTime || new Date(market.endTime) > now)
      );
  const isClosingSoon = isClosingSoonNonSportsMarket(market, now);
  const showLive = (cardScore ? !cardScore.completed : isLive) && !isClosingSoon;
  const isPending = !isResolved
    && !showLive
    && !cardScore
    && market.status === 'active'
    && market.endTime
    && new Date(market.endTime) < now;
  const isAicmDelayCard = isAicmDelayMarket(market);
  const matchTypeLabel = soccerMatchTypeLabel(market);
  const marketDetailPath = `/market?id=${encodeURIComponent(market.id)}`;
  const cardTargetPath = isAicmDelayCard && !isResolved
    ? AICM_HUB_PATH
    : marketDetailPath;
  const navigateToCardTarget = () => {
    trackInterest({
      ...marketInterestPayload('points', market, 'click'),
      objectType: 'points_market',
    });
    navigate(cardTargetPath);
  };
  const volume = displayedMarketVolume(market);

  function navigateToTeam(e, team) {
    if (!team) return;
    e.stopPropagation();
    trackInterest({
      ...teamInterestPayload('points', team, 'click'),
      objectType: 'team',
    });
    navigate(teamProfilePath(team));
  }

  const normalizedSides = outcomes.map(label => String(label).normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase());
  const yesIndex = normalizedSides.findIndex(side => side === 'si' || side === 'yes');
  const isYesNo = normalizedSides.length === 2 && yesIndex >= 0 && normalizedSides.includes('no');
  const outcomeRows = outcomes.map((label, i) => ({
    index: i,
    label,
    rawLabel: rawOutcomes[i] || label,
    price: prices[i],
    logo: outcomeImages?.[i] || null,
    countryLabel: outcomeCountryLabels?.[i] || null,
    legStatus: legStatuses?.[i] || null,
    legOutcome: legOutcomes?.[i] ?? null,
  }));
  const displayPrice = (row) => {
    if (!isResolved) return Number(row.price) || 0;
    if (market.ammMode === 'parallel' && row.legOutcome != null) {
      return Number(row.legOutcome) === 0 ? 1 : 0;
    }
    return Number(market.outcome) === row.index ? 1 : 0;
  };

  const activeParallelRows = market.ammMode === 'parallel' && !isResolved
    ? outcomeRows.filter(row => legStatuses
      ? String(row.legStatus || '').toLowerCase() === 'active'
      : Number(row.price) > 0)
    : [];
  const candidateRows = activeParallelRows.length ? activeParallelRows : outcomeRows;
  const rankedRows = outcomeRows.length > 3 || (market.ammMode === 'parallel' && !isResolved)
    ? [...candidateRows].sort((a, b) => displayPrice(b) - displayPrice(a) || a.index - b.index)
    : candidateRows;
  const visibleOutcomeRows = rankedRows.slice(0, 3);
  const moreOutcomes = outcomeRows.length > 3 ? outcomeRows.length - visibleOutcomeRows.length : 0;

  return (
    <div
      className="mock-card points-market-card points-ui-card"
      ref={cardRef}
      onClick={navigateToCardTarget}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        navigateToCardTarget();
      }}
    >
      <div className="mock-card-header">
        <div className="points-card-badges">
          <span className="points-card-category">
            {marketCategoryLabel(market.category, t)}
          </span>
          {market.isTestMarket && !isAicmDelayCard && (
            <span
              className="mock-card-badge test-market-badge"
              title={t('points.testMarket.tooltip')}
            >
              {t('points.testMarket.badge')}
            </span>
          )}
          {matchTypeLabel && (
            <span className="mock-card-badge points-card-status is-accent">
              {matchTypeLabel === 'TORNEO' ? 'Torneo' : matchTypeLabel}
            </span>
          )}
          {isResolved && (
            <span className="mock-card-badge points-card-status is-accent">
              {t('points.card.resolved')}
            </span>
          )}
          {showLive && (
            <span className="mock-card-badge points-card-status is-live">
              {t('points.card.live')}
            </span>
          )}
          {isClosingSoon && !isResolved && (
            <span className="mock-card-badge points-card-status is-warning">
              {t('points.card.closingSoon')}
            </span>
          )}
          {isPending && !isResolved && !showLive && !isClosingSoon && (
            <span className="mock-card-badge points-card-status is-warning">
              {t('points.card.pending')}
            </span>
          )}
          {isSeriesPending && !isResolved && !showLive && (
            <span className="mock-card-badge points-card-status is-warning">
              {t('points.series.pending')}
            </span>
          )}
          {userPosition && userPosition.shares > 0 && (
            <span className="mock-card-badge points-card-status is-accent">
              {t('points.card.yourPos')}
            </span>
          )}
        </div>
        <PointsBookmark market={market} />
      </div>

      <div className="mock-card-body">
        <div className="points-card-title-row" style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: cardScore ? 8 : 12,
          marginBottom: 8,
        }}>
          <MarketThumbnail market={market} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="mock-card-title" style={{ margin: 0 }}>{marketTitle}</p>
            {market.seriesMeta?.subtitle && (
              <div className="points-card-subtitle">
                {market.seriesMeta.subtitle}
              </div>
            )}
          </div>
          {cardScore && <CardLiveScore score={cardScore} />}
        </div>

        <div className="points-card-outcomes">
          {visibleOutcomeRows.map((row) => {
            const { index: i, label, rawLabel, price: livePrice, logo, countryLabel } = row;
            const pct = Math.round(displayPrice(row) * 100);
            const tone = isResolved
              ? (pct === 100 ? 'win' : '')
              : isYesNo ? (i === yesIndex ? 'yes' : 'no') : '';
            const gain = previewGain(livePrice);
            const teamProfile = findTeamByName(market.sport, rawLabel);
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
                className="points-card-outcome"
              >
                {/* Logo column. Reserve a 26px slot even when this
                    outcome has no image (e.g. 'Empate' on a 3-way
                    soccer row) so every label lines up at the same
                    x-offset as rows that do have a crest. */}
                {logo ? (
                  <OutcomeLogo src={logo} label={label} />
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
                  className={`points-card-outcome-label${teamProfile ? ' is-team' : ''}`}>
                  {label}
                </span>
                {countryLabel && <span className="points-card-country" title={countryLabel}>{countryLabel}</span>}
                <span className={`points-card-odds points-ui-number${tone ? ` is-${tone}` : ''}`}>
                  {isResolved
                    ? pct === 100 && <Check size={16} aria-label={t('detail.winner')} />
                    : <span className="points-card-gain">+{gain}</span>}
                  <span>{pct}%</span>
                </span>
              </div>
            );
          })}
          {moreOutcomes > 0 && (
            <Link
              className="points-card-more"
              to={marketDetailPath}
              onClick={event => event.stopPropagation()}
            >
              {t('points.card.moreOptions', { n: moreOutcomes })}
            </Link>
          )}
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
          borderRadius: 'var(--points-radius-sm)',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
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
          {t('points.card.volumeShort')} <span className="points-ui-number">{formatVolume(volume)}</span> MXNP
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
                question: marketTitle,
                title: marketTitle,
                ammMode: 'unified',
                outcomes: [lang === 'en' ? 'Yes' : 'Sí', 'No'],
                outcomeImages: null,
                // Display fields stay in sync with the chosen leg's
                // YES price so the modal's quote ticker isn't off.
                prices: [market.prices?.[drawerIndex] ?? 0.5, 1 - (market.prices?.[drawerIndex] ?? 0.5)],
              }
            : { ...market, question: marketTitle, title: marketTitle }}
          outcomeIndex={parallelLegs ? 0 : drawerIndex}
          outcomeLabel={outcomes[drawerIndex]}
          onClose={() => setDrawerIndex(null)}
          onSuccess={() => setDrawerIndex(null)}
        />
      )}
    </div>
  );
}
