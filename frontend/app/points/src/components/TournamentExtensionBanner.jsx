import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '@app/lib/i18n.js';
import {
  NEXT_TOURNAMENT_START_ISO,
  NEXT_TOURNAMENT_RANKING_CUTOFF_ISO,
  TOURNAMENT_TIME_ZONE,
} from '../../../../api/_lib/points-tournament-config.js';

const startsAt = Date.parse(NEXT_TOURNAMENT_START_ISO);
const closesAt = Date.parse(NEXT_TOURNAMENT_RANKING_CUTOFF_ISO);

export default function TournamentExtensionBanner() {
  const lang = useLang();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const boundary = now < startsAt ? startsAt : closesAt;
    if (now >= boundary) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(boundary - now, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [now]);

  if (now < startsAt || now >= closesAt) return null;

  const locale = lang === 'en' ? 'en-US' : 'es-MX';
  const dateLabel = new Intl.DateTimeFormat(locale, {
    timeZone: TOURNAMENT_TIME_ZONE, day: 'numeric', month: 'long',
  }).format(closesAt);
  const timeLabel = new Intl.DateTimeFormat(locale, {
    timeZone: TOURNAMENT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(closesAt);

  return (
    <aside
      aria-label={lang === 'en' ? 'Tournament announcement' : 'Aviso del torneo'}
      style={{ maxWidth: 1280, margin: '16px auto 0', padding: '0 clamp(16px, 4vw, 48px)' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '12px 24px', padding: '16px 20px',
        background: 'rgba(255, 107, 0, 0.09)', border: '1px solid var(--orange)',
        borderRadius: 12, fontFamily: 'var(--font-body)',
      }}>
        <div style={{ flex: '1 1 250px' }}>
          <strong style={{ display: 'block', color: 'var(--orange)', fontSize: 16 }}>
            {lang === 'en' ? 'One more day of the tournament!' : '¡Un día más de torneo!'}
          </strong>
          <p style={{ margin: '5px 0 0', color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.5 }}>
            {lang === 'en'
              ? `We extended the tournament by one day. It now closes on ${dateLabel} at ${timeLabel} Mexico City time.`
              : `Extendimos el torneo un día más. Ahora cierra el ${dateLabel} a las ${timeLabel} h (CDMX).`}
          </p>
        </div>
        <Link to="/torneo" className="filter-btn active" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {lang === 'en' ? 'View tournament' : 'Ver torneo'}
        </Link>
      </div>
    </aside>
  );
}
