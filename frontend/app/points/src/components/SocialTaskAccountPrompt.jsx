import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '@app/lib/i18n.js';
import { saveSocialLink, publicErrorMessage } from '../lib/pointsApi.js';
import { socialTaskProvider } from '../lib/socialTaskAccount.js';

export default function SocialTaskAccountPrompt({ task, onSaved, onCancel }) {
  const lang = useLang();
  const dialog = useRef(null);
  const [handle, setHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const provider = socialTaskProvider(task);
  const label = { x: 'X', instagram: 'Instagram', tiktok: 'TikTok' }[provider];

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function save(event) {
    event.preventDefault();
    if (saving || !handle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveSocialLink({ provider, handle: handle.trim() });
      if (!result?.link?.handle) throw new Error('social_link_failed');
      await onSaved(result.link);
    } catch (err) {
      setError(publicErrorMessage(err, lang, 'social_link_failed'));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <dialog ref={dialog} aria-labelledby="social-account-title" aria-describedby="social-account-description"
      onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}
      style={{ width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
        margin: 'auto', boxSizing: 'border-box', padding: 24,
        border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', color: 'var(--text-primary)' }}>
      <form onSubmit={save}>
        <h2 id="social-account-title" style={{ margin: '0 0 12px', fontFamily: 'var(--font-body)', fontSize: 21 }}>
          {lang === 'en' ? `What is your ${label} username?` : `¿Cuál es tu usuario de ${label}?`}
        </h2>
        <p id="social-account-description" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.5 }}>
          {lang === 'en'
            ? 'Add your account before sending this task for review. It will be saved privately in your profile so the team can check it.'
            : 'Añade tu cuenta antes de enviar esta tarea a revisión. Se guardará como privada en tu perfil para que el equipo pueda verificarla.'}
        </p>
        <label style={{ display: 'grid', gap: 8, fontFamily: 'var(--font-body)', fontSize: 14 }}>
          {lang === 'en' ? `${label} username` : `Usuario de ${label}`}
          <input autoFocus required autoComplete="off" maxLength={200} value={handle} placeholder="@tu_usuario"
            onChange={event => { setHandle(event.target.value); setError(null); }} disabled={saving}
            style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text-primary)', fontSize: 16, minWidth: 0 }} />
        </label>
        {error && <p role="alert" style={{ color: 'var(--danger)', fontFamily: 'var(--font-body)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !handle.trim()}>
            {saving ? '…' : (lang === 'en' ? 'Save and send for review' : 'Guardar y enviar revisión')}
          </button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
