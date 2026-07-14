import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getInvestorDeck } from '../lib/investorDeckManifest.js';
import {
  deckLogin,
  deckLogout,
  fetchDeckSession,
  submitDeckQuestion,
  trackDeckEvent,
} from '../lib/pointsApi.js';

const ACCENT = '#ff5a1f';
const GREEN = '#22c55e';
const DEFAULT_DECK_LANGUAGE = 'en';
const preloadedDeckImages = new Set();

function fmtSessionShort(id) {
  return String(id || '').slice(0, 8).toUpperCase();
}

function withTimeout(promise, ms, label = 'timeout') {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function preloadDeckImages(slides = []) {
  if (typeof window === 'undefined' || typeof window.Image === 'undefined') return;
  for (const slide of slides) {
    const src = slide?.image;
    if (!src || preloadedDeckImages.has(src)) continue;
    preloadedDeckImages.add(src);
    const image = new window.Image();
    image.decoding = 'async';
    image.src = src;
    image.decode?.().catch(() => {});
  }
}

export default function InvestorDeck() {
  const [language, setLanguage] = useState(DEFAULT_DECK_LANGUAGE);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [question, setQuestion] = useState('');
  const [questionState, setQuestionState] = useState(null);
  const enteredAtRef = useRef(Date.now());
  const sessionRef = useRef(null);
  const slideRef = useRef(1);
  const languageRef = useRef(language);

  const deck = useMemo(() => getInvestorDeck(language), [language]);
  const slides = deck.slides || [];
  const maxSlideIndex = Math.max(0, slides.length - 1);
  const safeSlideIndex = Math.min(Math.max(0, slideIndex), maxSlideIndex);
  const slide = slides[safeSlideIndex] || slides[0];
  const slideNumber = safeSlideIndex + 1;
  const slideKey = `${language}-${slideNumber}-${slide?.image || slide?.title || 'slide'}`;
  const watermark = session
    ? `${session.viewerEmail} · ${session.inviteLabel || 'Pronos'} · ${fmtSessionShort(session.id)}`
    : 'Pronos confidencial';

  useEffect(() => {
    if (slideIndex !== safeSlideIndex) setSlideIndex(safeSlideIndex);
  }, [safeSlideIndex, slideIndex]);

  useEffect(() => {
    preloadDeckImages(slides);
  }, [slides]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await withTimeout(fetchDeckSession(), 2500, 'deck_session_timeout');
        if (cancelled) return;
        setSession(data.session);
        setLanguage(DEFAULT_DECK_LANGUAGE);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  function flushEvent(eventType = 'slide_view') {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    const now = Date.now();
    const durationMs = Math.max(0, now - enteredAtRef.current);
    enteredAtRef.current = now;
    trackDeckEvent({
      slideNumber: slideRef.current,
      durationMs,
      eventType,
      language: languageRef.current,
      keepalive: eventType === 'hidden' || eventType === 'exit',
    }).catch(() => {});
  }

  useEffect(() => {
    if (!session) return undefined;
    flushEvent('slide_view');
    slideRef.current = slideNumber;
    enteredAtRef.current = Date.now();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideNumber, language, session?.id]);

  useEffect(() => {
    if (!session) return undefined;
    const id = window.setInterval(() => flushEvent('heartbeat'), 15_000);
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushEvent('hidden');
    }
    function onBeforeUnload() {
      flushEvent('exit');
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flushEvent('hidden');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  async function handleLogin(form) {
    setError(null);
    setLoading(true);
    try {
      const data = await withTimeout(deckLogin({ ...form, language }), 8000, 'deck_login_timeout');
      setSession(data.session);
      setSlideIndex(0);
      slideRef.current = 1;
      enteredAtRef.current = Date.now();
    } catch (e) {
      setError(e.code === 'invalid_invite' ? 'Código inválido o revocado.' : 'No pudimos abrir el deck.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    flushEvent('exit');
    await deckLogout().catch(() => {});
    setSession(null);
    setQuestion('');
    setQuestionState(null);
  }

  async function handleQuestionSubmit(e) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setQuestionState('sending');
    try {
      await withTimeout(submitDeckQuestion({ question: trimmed, slideNumber, language }), 8000, 'deck_question_timeout');
      setQuestion('');
      setQuestionState('sent');
    } catch {
      setQuestionState('error');
    }
  }

  if (loading && !session) {
    return (
      <main style={styles.page}>
        <div style={styles.loading}>Cargando deck...</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main style={styles.page}>
        <DeckGate
          language={language}
          setLanguage={setLanguage}
          onSubmit={handleLogin}
          error={error}
          loading={loading}
        />
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.viewerHeader}>
        <div>
          <div style={styles.kicker}>PRONOS · CONFIDENCIAL</div>
          <h1 style={styles.title}>{deck.title}</h1>
          <p style={styles.subtitle}>{deck.subtitle}</p>
        </div>
        <div style={styles.headerActions}>
          <LanguageToggle language={language} setLanguage={setLanguage} />
          <button type="button" onClick={handleLogout} style={styles.secondaryButton}>Salir</button>
        </div>
      </section>

      <section style={styles.deckGrid}>
        <aside style={styles.thumbnails} aria-label="Láminas">
          {slides.map((s, idx) => (
            <button
              key={`${language}-${idx}`}
              type="button"
              onClick={() => setSlideIndex(idx)}
              style={{
                ...styles.thumbnail,
                ...(idx === safeSlideIndex ? styles.thumbnailActive : null),
              }}
            >
              <span style={styles.thumbNumber}>{idx + 1}</span>
              <span style={styles.thumbTitle}>{s.title}</span>
            </button>
          ))}
        </aside>

        <div style={styles.stageWrap}>
          <div style={styles.stageMeta}>
            <span>Lámina {slideNumber} de {slides.length}</span>
            <span>{session.viewerEmail}</span>
          </div>
          <div key={slideKey} style={styles.slideStage}>
            <Watermark text={watermark} />
            <SlideVisual slide={slide} uploadHint={deck.uploadHint} slideKey={slideKey} />
          </div>
          <div style={styles.slideControls}>
            <button
              type="button"
              onClick={() => setSlideIndex(i => Math.max(0, i - 1))}
              disabled={safeSlideIndex === 0}
              style={styles.navButton}
            >
              Anterior
            </button>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, width: `${(slideNumber / slides.length) * 100}%` }} />
            </div>
            <button
              type="button"
              onClick={() => setSlideIndex(i => Math.min(maxSlideIndex, i + 1))}
              disabled={safeSlideIndex >= maxSlideIndex}
              style={styles.navButton}
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>

      <section style={styles.questionBox}>
        <div>
          <div style={styles.kicker}>PREGUNTAS</div>
          <h2 style={styles.sectionTitle}>Déjanos una pregunta</h2>
          <p style={styles.muted}>
            Solo el equipo de Pronos puede ver estas preguntas. Quedan ligadas a tu correo y a la lámina actual.
          </p>
        </div>
        <form onSubmit={handleQuestionSubmit} style={styles.questionForm}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Escribe tu pregunta..."
            style={styles.textarea}
            maxLength={1200}
          />
          <button type="submit" style={styles.primaryButton} disabled={questionState === 'sending'}>
            Enviar pregunta
          </button>
          {questionState === 'sent' && <span style={styles.successText}>Pregunta enviada.</span>}
          {questionState === 'error' && <span style={styles.errorText}>No se pudo enviar. Intenta otra vez.</span>}
        </form>
      </section>
    </main>
  );
}

function DeckGate({ language, setLanguage, onSubmit, error, loading }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  return (
    <section style={styles.gateShell}>
      <div style={styles.gatePanel}>
        <div style={styles.kicker}>PRONOS · ACCESO PRIVADO</div>
        <h1 style={styles.gateTitle}>Deck confidencial</h1>
        <p style={styles.gateCopy}>
          Ingresa tu correo y el código que te compartimos. Cada sesión queda marcada con watermark para proteger el material.
        </p>
        <LanguageToggle language={language} setLanguage={setLanguage} />
        <form
          style={styles.gateForm}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ email, code });
          }}
        >
          <label style={styles.label}>
            Correo
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="nombre@empresa.com"
              required
            />
          </label>
          <label style={styles.label}>
            Código
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={styles.input}
              placeholder="Código de acceso"
              required
            />
          </label>
          <button type="submit" style={styles.primaryButton} disabled={loading}>
            Abrir deck
          </button>
          {error && <div style={styles.errorBox}>{error}</div>}
        </form>
      </div>
    </section>
  );
}

function LanguageToggle({ language, setLanguage }) {
  return (
    <div style={styles.languageToggle}>
      {[
        ['en', 'EN'],
        ['es', 'ES'],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setLanguage(id)}
          style={{
            ...styles.languageButton,
            ...(language === id ? styles.languageActive : null),
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SlideVisual({ slide, uploadHint, slideKey }) {
  if (slide?.image) {
    return (
      <img
        key={slideKey}
        src={slide.image}
        alt={slide.title}
        style={styles.slideImage}
        draggable={false}
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
    );
  }
  return (
    <div style={styles.placeholderSlide}>
      <div style={styles.kicker}>{slide?.eyebrow || 'PRONOS'}</div>
      <h2 style={styles.placeholderTitle}>{slide?.title}</h2>
      <p style={styles.placeholderBody}>{slide?.body}</p>
      <p style={styles.uploadHint}>{uploadHint}</p>
    </div>
  );
}

function Watermark({ text }) {
  return (
    <div style={styles.watermarkLayer} aria-hidden="true">
      {Array.from({ length: 24 }).map((_, idx) => (
        <span key={idx} style={styles.watermarkText}>{text}</span>
      ))}
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    maxWidth: 1280,
    margin: '0 auto',
    padding: 'clamp(22px, 4vw, 52px) clamp(14px, 4vw, 28px) 72px',
    color: 'var(--text-primary)',
  },
  loading: {
    padding: 80,
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  gateShell: {
    minHeight: 'calc(100vh - 220px)',
    display: 'grid',
    placeItems: 'center',
  },
  gatePanel: {
    width: 'min(560px, 100%)',
    background: 'linear-gradient(180deg, rgba(255,90,31,0.10), rgba(255,255,255,0.025))',
    border: '1px solid rgba(255,90,31,0.30)',
    borderRadius: 12,
    padding: 'clamp(22px, 5vw, 42px)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
  },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.14em',
    color: ACCENT,
    textTransform: 'uppercase',
  },
  gateTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(38px, 8vw, 68px)',
    lineHeight: 0.92,
    margin: '14px 0 14px',
    textTransform: 'uppercase',
  },
  gateCopy: {
    color: 'var(--text-muted)',
    fontSize: 16,
    lineHeight: 1.55,
    maxWidth: 440,
    marginBottom: 24,
  },
  gateForm: {
    display: 'grid',
    gap: 14,
    marginTop: 22,
  },
  label: {
    display: 'grid',
    gap: 8,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.12em',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  input: {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.045)',
    borderRadius: 8,
    padding: '14px 14px',
    color: 'var(--text-primary)',
    font: 'inherit',
    letterSpacing: 0,
    textTransform: 'none',
  },
  primaryButton: {
    border: '1px solid rgba(255,90,31,0.75)',
    background: ACCENT,
    color: '#090909',
    borderRadius: 8,
    padding: '13px 18px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.045)',
    color: 'var(--text-primary)',
    borderRadius: 8,
    padding: '11px 14px',
    cursor: 'pointer',
  },
  errorBox: {
    border: '1px solid rgba(239,68,68,0.45)',
    background: 'rgba(239,68,68,0.10)',
    color: '#ff6b6b',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
  languageToggle: {
    display: 'inline-flex',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: 3,
    gap: 2,
    background: 'rgba(255,255,255,0.035)',
  },
  languageButton: {
    border: 'none',
    borderRadius: 999,
    background: 'transparent',
    color: 'var(--text-muted)',
    padding: '8px 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    cursor: 'pointer',
  },
  languageActive: {
    background: 'rgba(255,90,31,0.18)',
    color: ACCENT,
  },
  viewerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 18,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  headerActions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(42px, 8vw, 82px)',
    lineHeight: 0.9,
    margin: '10px 0 8px',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: 'var(--text-muted)',
    margin: 0,
    fontSize: 16,
  },
  deckGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 240px) 1fr',
    gap: 18,
  },
  thumbnails: {
    display: 'grid',
    gap: 8,
    alignContent: 'start',
  },
  thumbnail: {
    display: 'grid',
    gridTemplateColumns: '28px 1fr',
    gap: 10,
    alignItems: 'center',
    textAlign: 'left',
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.025)',
    color: 'var(--text-muted)',
    borderRadius: 8,
    padding: '12px 10px',
    cursor: 'pointer',
  },
  thumbnailActive: {
    borderColor: 'rgba(255,90,31,0.75)',
    background: 'rgba(255,90,31,0.12)',
    color: 'var(--text-primary)',
  },
  thumbNumber: {
    fontFamily: 'var(--font-mono)',
    color: ACCENT,
    fontSize: 12,
  },
  thumbTitle: {
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  stageWrap: {
    minWidth: 0,
  },
  stageMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  slideStage: {
    position: 'relative',
    overflow: 'hidden',
    aspectRatio: '16 / 9',
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: '#0d0d0d',
  },
  slideImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
  },
  placeholderSlide: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '8%',
    background: 'radial-gradient(circle at 15% 15%, rgba(255,90,31,0.20), transparent 34%), linear-gradient(135deg, #111, #050505)',
  },
  placeholderTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(42px, 8vw, 96px)',
    lineHeight: 0.88,
    textTransform: 'uppercase',
    margin: '18px 0',
  },
  placeholderBody: {
    maxWidth: 720,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 'clamp(18px, 2vw, 30px)',
    lineHeight: 1.28,
    margin: 0,
  },
  uploadHint: {
    marginTop: 28,
    color: 'rgba(255,255,255,0.38)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
  watermarkLayer: {
    position: 'absolute',
    inset: '-15%',
    zIndex: 3,
    pointerEvents: 'none',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 18,
    transform: 'rotate(-24deg)',
    opacity: 0.18,
    mixBlendMode: 'screen',
  },
  watermarkText: {
    color: 'rgba(255,255,255,0.42)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  slideControls: {
    display: 'grid',
    gridTemplateColumns: '120px 1fr 120px',
    gap: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  navButton: {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--text-primary)',
    borderRadius: 8,
    padding: '11px 12px',
    cursor: 'pointer',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.08)',
  },
  progressFill: {
    height: '100%',
    background: `linear-gradient(90deg, ${ACCENT}, ${GREEN})`,
  },
  questionBox: {
    marginTop: 28,
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 360px) 1fr',
    gap: 24,
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
    background: 'rgba(255,255,255,0.025)',
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 34,
    margin: '8px 0',
    textTransform: 'uppercase',
  },
  muted: {
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    margin: 0,
  },
  questionForm: {
    display: 'grid',
    gap: 12,
  },
  textarea: {
    minHeight: 120,
    resize: 'vertical',
    border: '1px solid var(--border)',
    background: 'rgba(0,0,0,0.26)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    padding: 14,
    font: 'inherit',
  },
  successText: {
    color: GREEN,
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
  errorText: {
    color: '#ff6b6b',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
};
