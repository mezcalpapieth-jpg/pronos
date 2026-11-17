import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLang, useT } from '@app/lib/i18n.js';
import {
  fetchNotifications,
  markNotificationsRead,
  saveNotificationSettings,
} from '../lib/pointsApi.js';
import './PointsNotifications.css';

const UNREAD_POLL_INTERVAL = 60_000;

function destination(item) {
  if (item.marketId == null) return '/portfolio';
  return `/market?id=${encodeURIComponent(item.marketId)}${item.kind === 'comment_reply' ? '#comments' : ''}`;
}

export default function PointsNotifications() {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'en' ? 'en-US' : 'es-MX';
  const panelId = useId();
  const wrapper = useRef(null);
  const bell = useRef(null);
  const feedRequest = useRef(null);
  const [params, setParams] = useSearchParams();
  const showFromLink = params.get('notifications') === '1';
  const [open, setOpen] = useState(showFromLink);
  const [unread, setUnread] = useState(0);
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updatingRead, setUpdatingRead] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [error, setError] = useState(null);
  const [showPreferences, setShowPreferences] = useState(showFromLink);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (showFromLink) {
      setParams(current => {
        const next = new URLSearchParams(current);
        next.delete('notifications');
        return next;
      }, { replace: true });
    }
    if (restoreFocus) bell.current?.focus();
  }, [setParams, showFromLink]);

  useEffect(() => {
    if (!showFromLink) return;
    setOpen(true);
    setShowPreferences(true);
  }, [showFromLink]);

  useEffect(() => {
    if (open) return;
    const controller = new AbortController();
    async function refreshCount() {
      if (document.visibilityState === 'hidden') return;
      try {
        const result = await fetchNotifications({ countOnly: true, signal: controller.signal });
        if (!controller.signal.aborted) setUnread(result.unread);
      } catch {
        // Keep the last count when a background refresh fails.
      }
    }
    refreshCount();
    const timer = window.setInterval(refreshCount, UNREAD_POLL_INTERVAL);
    document.addEventListener('visibilitychange', refreshCount);
    window.addEventListener('focus', refreshCount);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshCount);
      window.removeEventListener('focus', refreshCount);
    };
  }, [open]);

  const load = useCallback(async ({ signal, beforeId } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchNotifications({ beforeId, signal });
      if (signal?.aborted) return;
      setUnread(page.unread);
      setFeed(old => beforeId ? { ...page, items: [...old.items, ...page.items] } : page);
    } catch {
      if (!signal?.aborted) setError('points.notifications.loadFail');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    feedRequest.current = controller;
    load({ signal: controller.signal });
    return () => {
      controller.abort();
      feedRequest.current = null;
    };
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event) {
      if (!wrapper.current?.contains(event.target)) close();
    }
    function dismissWithEscape(event) {
      if (event.key === 'Escape') close(true);
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [close, open]);

  async function markRead(item = null) {
    if (updatingRead || (item && item.readAt)) return;
    const newest = feed?.items[0];
    if (!newest) return;
    setUpdatingRead(true);
    setError(null);
    try {
      const { unread: nextUnread } = await markNotificationsRead(item ? { id: item.id } : { throughId: newest.id });
      const now = new Date().toISOString();
      setFeed(current => current && {
        ...current,
        items: current.items.map(entry => {
          const marked = item ? entry.id === item.id : BigInt(entry.id) <= BigInt(newest.id);
          return marked ? { ...entry, readAt: entry.readAt || now } : entry;
        }),
      });
      setUnread(nextUnread);
    } catch {
      setError('points.notifications.updateFail');
    } finally {
      setUpdatingRead(false);
    }
  }

  async function updateEmail(event) {
    setSavingEmail(true);
    setError(null);
    try {
      const { resolutionEmail } = await saveNotificationSettings({
        resolutionEmail: event.target.checked,
        language: lang,
      });
      setFeed(current => ({ ...current, resolutionEmail }));
    } catch {
      setError('points.notifications.updateFail');
    } finally {
      setSavingEmail(false);
    }
  }

  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const formatAmount = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
  return (
    <div className="points-notifications" ref={wrapper}>
      <button
        type="button"
        className="points-notifications-bell"
        ref={bell}
        aria-label={unread ? t('points.notifications.unread', { count: unread }) : t('points.notifications.title')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => open ? close() : setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="points-notifications-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <section className="points-notifications-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
          <header>
            <h2 id={`${panelId}-title`}>{t('points.notifications.title')}</h2>
            <button type="button" className="points-notifications-close" onClick={() => close(true)} aria-label={t('points.notifications.close')}>×</button>
          </header>
          <div className="points-notifications-content" aria-busy={loading}>
            {error && (
              <div className="points-notifications-status" role="alert">
                {t(error)}
                {!feed && (
                  <button type="button" disabled={loading} onClick={() => load({ signal: feedRequest.current?.signal })}>
                    {t('points.notifications.retry')}
                  </button>
                )}
              </div>
            )}
            {loading && !feed && <p className="points-notifications-status" role="status">{t('points.notifications.loading')}</p>}
            {feed && (
              <>
                {feed.items.length === 0 ? (
                  <p className="points-notifications-status">{t('points.notifications.empty')}</p>
                ) : (
                  <>
                    {unread > 0 && (
                      <button
                        className="points-notifications-mark-all"
                        type="button"
                        disabled={loading || updatingRead}
                        onClick={() => markRead()}
                      >
                        {t('points.notifications.markAllRead')}
                      </button>
                    )}
                    <ul className="points-notifications-list">
                      {feed.items.map(item => (
                        <li key={item.id} className={item.readAt ? undefined : 'points-notification-unread'}>
                          <Link to={destination(item)} onClick={() => { markRead(item); close(); }}>
                            {!item.readAt && <span className="sr-only">{t('points.notifications.unreadFlag')} </span>}
                            <strong>{t(`points.notifications.${item.kind}`, { amount: formatAmount.format(item.amount || 0) })}</strong>
                            {item.question && <span>{item.question}</span>}
                            <time dateTime={item.createdAt}>{formatDate.format(new Date(item.createdAt))}</time>
                          </Link>
                          {!item.readAt && (
                            <button
                              type="button"
                              className="points-notifications-read"
                              aria-label={t('points.notifications.markRead')}
                              title={t('points.notifications.markRead')}
                              disabled={loading || updatingRead}
                              onClick={() => markRead(item)}
                            >
                              <span aria-hidden="true">✓</span>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {feed.nextBeforeId && (
                      <button type="button" className="points-notifications-more" disabled={loading || updatingRead}
                        onClick={() => load({ beforeId: feed.nextBeforeId, signal: feedRequest.current?.signal })}>
                        {t('points.notifications.more')}
                      </button>
                    )}
                  </>
                )}
                <details open={showPreferences} onToggle={event => setShowPreferences(event.currentTarget.open)}>
                  <summary>{t('points.notifications.preferences')}</summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={feed.resolutionEmail}
                      onChange={updateEmail}
                      disabled={loading || savingEmail || (!feed.hasEmail && !feed.resolutionEmail)}
                    />
                    {t('points.notifications.resolutionEmail')}
                  </label>
                  <p>{t(feed.hasEmail ? 'points.notifications.resolutionEmailHelp' : 'points.notifications.noEmail')}</p>
                </details>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
