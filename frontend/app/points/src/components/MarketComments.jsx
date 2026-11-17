import React, { useEffect, useRef, useState } from 'react';
import {
  deleteComment,
  fetchCommentReplies,
  fetchComments,
  postComment,
  publicErrorMessage,
  setCommentLike,
} from '../lib/pointsApi.js';
import { useLang, useT } from '@app/lib/i18n.js';
import './MarketComments.css';

const MAX_BODY = 1000;

function formatAgo(iso) {
  const then = new Date(iso).getTime();
  if (!iso || !Number.isFinite(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
  return `${Math.round(diffSec / 86400)}d`;
}

function CommentComposer({ authenticated, onOpenLogin, parent, onPosted, onCancel, marketId }) {
  const t = useT();
  const lang = useLang();
  const input = useRef(null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (parent) input.current?.focus();
  }, [parent?.id]);

  async function submit(event) {
    event.preventDefault();
    if (!authenticated) { onOpenLogin?.(); return; }
    if (submitting || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { comment } = await postComment(marketId, body.trim(), parent?.id);
      setBody('');
      onPosted(comment);
    } catch (error) {
      setError(publicErrorMessage(error, lang, 'default'));
    } finally {
      setSubmitting(false);
    }
  }

  const prompt = parent
    ? t('points.comments.replyTo', { name: parent.username })
    : t(authenticated ? 'points.comments.placeholderAuth' : 'points.comments.placeholderAnon');

  return (
    <form onSubmit={submit} className="points-comment-composer">
      <textarea
        ref={input}
        value={body}
        onChange={event => setBody(event.target.value)}
        rows={2}
        maxLength={MAX_BODY}
        aria-label={prompt}
        placeholder={prompt}
        disabled={!authenticated || submitting}
      />
      <div className="points-comment-toolbar">
        <span>{body.length}/{MAX_BODY}</span>
        {parent && (
          <button type="button" className="points-comment-action" onClick={onCancel}>
            {t('points.comments.replyCancel')}
          </button>
        )}
        {authenticated ? (
          <button type="submit" className="btn-primary" disabled={submitting || !body.trim()}>
            {t(submitting ? 'points.comments.posting' : 'points.comments.post')}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={onOpenLogin}>
            {t('points.comments.login')}
          </button>
        )}
      </div>
      {error && <p className="points-comment-error" role="alert">{error}</p>}
    </form>
  );
}

function Comment({ comment, username, onLike, onReply, onDelete, busy, children }) {
  const t = useT();
  if (comment.deleted) {
    return (
      <article className="points-comment">
        <p className="points-comment-muted">{t('points.comments.deleted')}</p>
        {children}
      </article>
    );
  }

  return (
    <article className="points-comment">
      <header>
        <strong>{comment.username}</strong>
        <time dateTime={comment.createdAt}>{formatAgo(comment.createdAt)}</time>
        {username === comment.username && (
          <button type="button" className="points-comment-action points-comment-delete" onClick={onDelete}>
            {t('points.comments.delete')}
          </button>
        )}
      </header>
      <p className="points-comment-body">{comment.body}</p>
      <div className="points-comment-actions">
        <button type="button" className="points-comment-action" aria-pressed={comment.liked}
          disabled={busy} onClick={onLike}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill={comment.liked ? 'currentColor' : 'none'}
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.8 8.6c0 4-4.2 6.9-8.8 10.4-4.6-3.5-8.8-6.4-8.8-10.4 0-4.5 5.6-5.9 8.8-2.1 3.2-3.8 8.8-2.4 8.8 2.1Z" />
          </svg>
          {t('points.comments.like')} {comment.likeCount}
        </button>
        {onReply && (
          <button type="button" className="points-comment-action" onClick={onReply}>
            {t('points.comments.reply')}
          </button>
        )}
      </div>
      {children}
    </article>
  );
}

function MarketCommentFeed({ marketId, authenticated, username, onOpenLogin }) {
  const t = useT();
  const lang = useLang();
  const [comments, setComments] = useState([]);
  const [threads, setThreads] = useState({});
  const [expanded, setExpanded] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const [busyLikes, setBusyLikes] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!marketId) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    fetchComments(marketId, { signal: controller.signal })
      .then(list => { if (!controller.signal.aborted) setComments(list); })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [marketId, retry]);

  async function loadReplies(parentId, afterId) {
    setThreads(current => ({
      ...current, [parentId]: { ...current[parentId], loading: true, failed: false },
    }));
    try {
      const { comments: replies, nextAfterId } = await fetchCommentReplies(marketId, parentId, { afterId });
      setThreads(current => {
        const merged = new Map((current[parentId]?.replies || []).map(reply => [reply.id, reply]));
        for (const reply of replies) merged.set(reply.id, reply);
        return {
          ...current,
          [parentId]: { replies: [...merged.values()].sort((a, b) => a.id - b.id), nextAfterId },
        };
      });
    } catch {
      setThreads(current => ({
        ...current, [parentId]: { ...current[parentId], loading: false, failed: true },
      }));
    }
  }

  function toggleReplies(parentId) {
    const open = !expanded[parentId];
    setExpanded(current => ({ ...current, [parentId]: open }));
    if (open && !threads[parentId]?.replies && !threads[parentId]?.loading) loadReplies(parentId);
  }

  function beginReply(parent) {
    if (!authenticated) { onOpenLogin?.(); return; }
    setReplyTo(parent);
    setExpanded(current => ({ ...current, [parent.id]: true }));
    if (parent.replyCount && !threads[parent.id]?.replies && !threads[parent.id]?.loading) loadReplies(parent.id);
  }

  function updateComment(comment, update) {
    if (comment.parentId) {
      setThreads(current => {
        const thread = current[comment.parentId];
        if (!thread?.replies) return current;
        return {
          ...current,
          [comment.parentId]: { ...thread, replies: thread.replies.map(row => row.id === comment.id ? update(row) : row).filter(Boolean) },
        };
      });
    } else {
      setComments(current => current.map(row => row.id === comment.id ? update(row) : row).filter(Boolean));
    }
  }

  async function like(comment) {
    if (!authenticated) { onOpenLogin?.(); return; }
    if (busyLikes[comment.id]) return;
    const liked = !comment.liked;
    const delta = liked ? 1 : -1;
    setError(null);
    setBusyLikes(current => ({ ...current, [comment.id]: true }));
    updateComment(comment, row => ({ ...row, liked, likeCount: Math.max(0, row.likeCount + delta) }));
    try {
      await setCommentLike(comment.id, liked);
    } catch {
      updateComment(comment, row => ({ ...row, liked: comment.liked, likeCount: Math.max(0, row.likeCount - delta) }));
      setError(t('points.comments.likeFail'));
    } finally {
      setBusyLikes(current => ({ ...current, [comment.id]: false }));
    }
  }

  async function remove(comment) {
    if (!window.confirm(t('points.comments.confirmDelete'))) return;
    setError(null);
    try {
      await deleteComment(comment.id);
      if (comment.parentId) {
        updateComment(comment, () => null);
        setComments(current => current.map(row => row.id === comment.parentId
          ? { ...row, replyCount: Math.max(0, row.replyCount - 1) }
          : row).filter(row => !row.deleted || row.replyCount > 0));
      } else {
        updateComment(comment, row => row.replyCount
          ? { ...row, body: null, username: null, deleted: true }
          : null);
        if (replyTo?.id === comment.id) setReplyTo(null);
      }
    } catch (error) {
      setError(t('points.comments.deleteFail', { err: publicErrorMessage(error, lang, 'default') }));
    }
  }

  function posted(comment) {
    if (!comment.parentId) {
      setComments(current => [comment, ...current.filter(row => row.id !== comment.id)]);
      return;
    }
    setReplyTo(null);
    setComments(current => current.map(row => row.id === comment.parentId
      ? { ...row, replyCount: row.replyCount + 1 }
      : row));
    setThreads(current => {
      const thread = current[comment.parentId];
      const replies = (thread?.replies || []).filter(row => row.id !== comment.id);
      return { ...current, [comment.parentId]: { ...thread, replies: [...replies, comment] } };
    });
  }

  const composer = { authenticated, onOpenLogin, marketId, onPosted: posted };
  const actionProps = comment => ({
    comment, username: authenticated ? username : null,
    onLike: () => like(comment), onDelete: () => remove(comment), busy: busyLikes[comment.id],
  });
  const count = comments.reduce((total, comment) => total + Number(!comment.deleted) + comment.replyCount, 0);

  return (
    <section id="comments" className="points-market-comments" aria-labelledby="points-comments-title">
      <div className="points-comments-header">
        <h2 id="points-comments-title">{t('points.comments.title')}</h2>
        {!loading && !loadFailed && (
          <span>{t(count === 1 ? 'points.comments.one' : 'points.comments.many', { n: count })}</span>
        )}
      </div>
      <CommentComposer {...composer} />
      {error && <p role="alert" className="points-comment-error">{error}</p>}
      {loading && <p className="points-comment-muted">{t('points.comments.loading')}</p>}
      {loadFailed && (
        <p className="points-comment-muted">
          {t('points.comments.loadFail')}{' '}
          <button type="button" className="points-comment-action" onClick={() => setRetry(value => value + 1)}>
            {t('points.comments.retry')}
          </button>
        </p>
      )}
      {!loading && !loadFailed && !comments.length && <p className="points-comment-muted">{t('points.comments.empty')}</p>}
      <div className="points-comment-list">
        {comments.map(comment => {
          const thread = threads[comment.id];
          return (
            <Comment key={comment.id} {...actionProps(comment)} onReply={() => beginReply(comment)}>
              {comment.replyCount > 0 && (
                <button type="button" className="points-comment-action points-comment-thread-toggle"
                  aria-expanded={Boolean(expanded[comment.id])}
                  aria-controls={`points-comment-thread-${comment.id}`} onClick={() => toggleReplies(comment.id)}>
                  {t(comment.replyCount === 1 ? 'points.comments.replyOne' : 'points.comments.replyMany', { n: comment.replyCount })}
                </button>
              )}
              <div id={`points-comment-thread-${comment.id}`} hidden={!expanded[comment.id]} className="points-comment-thread">
                {replyTo?.id === comment.id && (
                  <CommentComposer {...composer} parent={replyTo} onCancel={() => setReplyTo(null)} />
                )}
                {thread?.replies?.map(reply => <Comment key={reply.id} {...actionProps(reply)} />)}
                {thread?.loading && <p className="points-comment-muted">{t('points.comments.loading')}</p>}
                {thread?.failed && <p className="points-comment-error">{t('points.comments.loadRepliesFail')}</p>}
                {(thread?.nextAfterId || thread?.failed) && (
                  <button type="button" className="points-comment-action" disabled={thread.loading}
                    onClick={() => loadReplies(comment.id, thread.nextAfterId)}>
                    {t(thread.failed ? 'points.comments.retry' : 'points.comments.moreReplies')}
                  </button>
                )}
              </div>
            </Comment>
          );
        })}
      </div>
    </section>
  );
}

export default function MarketComments(props) {
  return <MarketCommentFeed key={`${props.marketId}:${props.authenticated ? props.username : ''}`} {...props} />;
}
