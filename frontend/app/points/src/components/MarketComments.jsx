/**
 * Per-market comments block.
 *
 * Renders below the chart on the market detail page. Signed-in users get
 * a textarea + submit button at the top; the latest comments show below.
 * Authors can hide their own comments via a small "Eliminar" link.
 *
 * All network calls go through pointsApi; errors are shown inline so the
 * host page stays quiet on failure.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { fetchComments, postComment, deleteComment } from '../lib/pointsApi.js';

const MAX_BODY = 1000;

function formatAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
  return `${Math.round(diffSec / 86400)}d`;
}

export default function MarketComments({ marketId, authenticated, username, onOpenLogin }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!marketId) return;
    setLoading(true);
    try {
      const list = await fetchComments(marketId);
      setComments(list);
    } catch (e) {
      // Non-fatal — show empty. Trade widget shouldn't break on a
      // comments fetch hiccup.
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!authenticated) { onOpenLogin?.(); return; }
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await postComment(marketId, trimmed);
      setBody('');
      await load();
    } catch (e) {
      setError(e.code || e.message || 'post_failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este comentario?')) return;
    try {
      await deleteComment(id);
      setComments(prev => prev.filter(c => c.id !== id));
    } catch (e) {
      alert(`No se pudo eliminar: ${e.code || e.message}`);
    }
  }

  return (
    <section style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '20px 22px',
      marginBottom: 24,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 14,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          Comentarios
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
        }}>
          {loading ? '…' : `${comments.length} ${comments.length === 1 ? 'mensaje' : 'mensajes'}`}
        </div>
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} style={{ marginBottom: 18 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={MAX_BODY}
          placeholder={authenticated
            ? 'Comparte tu análisis o pregunta…'
            : 'Inicia sesión para comentar.'}
          disabled={!authenticated || submitting}
          style={{
            width: '100%',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 12px',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: 'var(--text-primary)',
            outline: 'none',
            resize: 'vertical',
            minHeight: 46,
          }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: body.length > MAX_BODY * 0.9 ? '#f59e0b' : 'var(--text-muted)',
          }}>
            {body.length}/{MAX_BODY}
          </span>
          {!authenticated ? (
            <button
              type="button"
              onClick={() => onOpenLogin?.()}
              className="btn-primary"
              style={{ padding: '8px 14px', fontSize: 11 }}
            >
              Iniciar sesión
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting || body.trim().length === 0}
              className="btn-primary"
              style={{ padding: '8px 14px', fontSize: 11, opacity: (submitting || body.trim().length === 0) ? 0.5 : 1 }}
            >
              {submitting ? 'Publicando…' : 'Publicar'}
            </button>
          )}
        </div>
        {error && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--red, #ef4444)',
            marginTop: 6,
          }}>
            {error}
          </div>
        )}
      </form>

      {/* Feed */}
      {loading ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          Cargando comentarios…
        </p>
      ) : comments.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          Aún no hay comentarios. Sé el primero.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.map(c => (
            <article
              key={c.id}
              style={{
                padding: '10px 12px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
              }}
            >
              <header style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 6,
                gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--green)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {c.username}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                  }}>
                    · {formatAgo(c.createdAt)}
                  </span>
                </div>
                {authenticated && c.username === username && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      cursor: 'pointer',
                      padding: 0,
                      letterSpacing: '0.04em',
                    }}
                    title="Eliminar comentario"
                  >
                    eliminar
                  </button>
                )}
              </header>
              <p style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
              }}>
                {c.body}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
