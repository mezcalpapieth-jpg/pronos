/**
 * MVP Admin — placeholder page.
 *
 * The full admin suite (create market, approve Polymarket, resolve, etc.)
 * lives in the Points admin at pronos.io/admin — same backend, same
 * permission check, operates on the same points_markets table which now
 * carries both mode='points' and mode='onchain' rows.
 *
 * This stub keeps the /mvp/admin route from crashing and points the
 * operator at the real panel.
 */
import React from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

export default function Admin({ username, userIsAdmin, loading, onOpenLogin }) {
  const t = useT();
  const { authenticated } = usePointsAuth();

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main style={{ padding: '48px 48px 80px', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 16 }}>
          Admin
        </h1>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>
        ) : !authenticated ? (
          <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>
              Inicia sesión para ver el panel administrativo.
            </p>
            <button className="btn-primary" onClick={onOpenLogin}>
              {t('nav.predict') || 'Iniciar sesión'}
            </button>
          </div>
        ) : !userIsAdmin ? (
          <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', color: 'var(--text-secondary)' }}>
            Tu usuario <strong>{username}</strong> no tiene permisos administrativos.
          </div>
        ) : (
          <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              El panel completo de administración vive en{' '}
              <a href="/admin" style={{ color: 'var(--green)', fontWeight: 600 }}>pronos.io/admin</a>
              {' '}— mismo backend, misma tabla de mercados. Los mercados on-chain del MVP (mode=onchain) se listan ahí junto a los off-chain.
            </p>
            <a href="/admin" className="btn-primary" style={{ display: 'inline-block' }}>
              Abrir admin completo →
            </a>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
