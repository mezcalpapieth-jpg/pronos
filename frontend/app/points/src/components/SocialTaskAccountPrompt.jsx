import React, { useState } from 'react';
import { Button, Input, Modal } from '../ui/index.jsx';
import { useLang } from '@app/lib/i18n.js';
import { saveSocialLink, publicErrorMessage } from '../lib/pointsApi.js';
import { socialTaskProvider } from '../lib/socialTaskAccount.js';

export default function SocialTaskAccountPrompt({ task, onSaved, onCancel, returnFocusTo }) {
  const lang = useLang();
  const [handle, setHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const provider = socialTaskProvider(task);
  const label = { x: 'X', instagram: 'Instagram', tiktok: 'TikTok' }[provider];

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

  return (
    <Modal
      className="points-profile-modal"
      aria-labelledby="social-account-title"
      aria-describedby="social-account-description"
      onDismiss={() => { if (!saving) onCancel(); }}
      returnFocusTo={returnFocusTo}
    >
      <form onSubmit={save}>
        <h2 id="social-account-title" className="points-profile-title">
          {lang === 'en' ? `What is your ${label} username?` : `¿Cuál es tu usuario de ${label}?`}
        </h2>
        <p id="social-account-description" className="points-profile-description">
          {lang === 'en'
            ? 'Add your account before sending this task for review. It will be saved privately in your profile so the team can check it.'
            : 'Añade tu cuenta antes de enviar esta tarea a revisión. Se guardará como privada en tu perfil para que el equipo pueda verificarla.'}
        </p>
        <label className="points-profile-field">
          {lang === 'en' ? `${label} username` : `Usuario de ${label}`}
          <Input autoFocus required autoComplete="off" maxLength={200} value={handle} placeholder="@tu_usuario"
            onChange={event => { setHandle(event.target.value); setError(null); }} disabled={saving} />
        </label>
        {error && <p role="alert" className="points-profile-notice points-profile-error">{error}</p>}
        <div className="points-profile-task-actions">
          <Button onClick={onCancel} disabled={saving}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !handle.trim()}>
            {saving ? '…' : (lang === 'en' ? 'Save and send for review' : 'Guardar y enviar revisión')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
