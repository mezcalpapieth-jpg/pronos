import React from 'react';
import { ChartNoAxesColumn, BriefcaseBusiness, Trophy, UserRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import './points-browse.css';

export default function PointsBottomNav({ authenticated, onOpenLogin, claimableCount, tournamentTaskCount, showTournament = true, showEarn = true }) {
  const { pathname } = useLocation();
  const t = useT();
  const marketsActive = pathname === '/' || /^\/(c|market|stocks|teams)(\/|$)/.test(pathname);
  const links = [
    { to: '/', icon: ChartNoAxesColumn, label: 'points.nav.mobileMarkets', active: marketsActive },
    { to: '/portfolio', icon: BriefcaseBusiness, label: 'points.nav.portfolio', restricted: true, badge: claimableCount },
    showTournament && { to: '/torneo', icon: Trophy, label: 'points.nav.mobileTournament', badge: tournamentTaskCount },
    showEarn && { to: '/earn', icon: UserRound, label: 'points.nav.earn', restricted: true },
  ].filter(Boolean);

  return (
    <nav className="points-bottom-nav" aria-label={t('points.nav.mobileNavigation')}>
      {links.map(({ to, icon: Icon, label, active, restricted, badge }) => {
        const content = (
          <>
            <span className="points-bottom-nav-icon">
              <Icon size={20} aria-hidden="true" />
              {badge > 0 && <span className="points-mobile-menu-badge">{badge > 99 ? '99+' : badge}</span>}
            </span>
            <span>{t(label)}</span>
          </>
        );
        return restricted && !authenticated ? (
          <button key={to} type="button" onClick={onOpenLogin}>{content}</button>
        ) : (
          <Link key={to} to={to} aria-current={(active ?? pathname.replace(/\/+$/, '') === to) ? 'page' : undefined}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
