import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const REFRESH_MS = 2_000;
const BALL_COUNT = 183;
const QUESTION = '¿Cuántas pelotas de ping-pong hay en el frasco?';
const STAGE_QUESTION = '¿Qué tan cerca puede llegar la inteligencia colectiva?';
const BALL_COLORS = ['#fff4d2', '#ff6a1a', '#00e87a', '#4da3ff', '#ffd84d', '#ff4d8f'];
const BALL_MODEL_RADIUS = 0.225;
const JAR_BOTTOM_RADIUS = 0.98;
const JAR_BODY_RADIUS = 1.3;
const JAR_MOUTH_RADIUS = 0.84;
const JAR_BOTTOM_Y = -2.02;
const HIDDEN_METRICS_STORAGE_KEY = 'pronos-ris26-hidden-metrics';
const DEFAULT_HIDDEN_METRICS = {
  mean: false,
  total: false,
  range: false,
  leader: false,
};
const EMPTY_STATS = {
  event: { title: 'RIS 26', question: QUESTION },
  stats: { total: 0, mean: null, min: null, max: null, updatedAt: null },
  distribution: [],
  recent: [],
  ownGuess: null,
};

function fmt(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value));
}

function isParticipantPath() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.endsWith('/participar') || params.get('participar') === '1';
}

function participantUrl() {
  if (typeof window === 'undefined') return 'https://pronos.io/ris26/participar';
  return `${window.location.origin}/ris26/participar`;
}

function qrUrl(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=14&data=${encodeURIComponent(url)}`;
}

function readStoredSubmission() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('pronos-ris26-submission');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed?.guess) ? parsed : null;
  } catch {
    return null;
  }
}

function storeSubmission(guess) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('pronos-ris26-submission', JSON.stringify({
      guess,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Storage is best effort; the server cookie still remembers the device.
  }
}

function readHiddenMetrics() {
  if (typeof window === 'undefined') return DEFAULT_HIDDEN_METRICS;
  try {
    const raw = window.localStorage.getItem(HIDDEN_METRICS_STORAGE_KEY);
    if (!raw) return DEFAULT_HIDDEN_METRICS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_HIDDEN_METRICS,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return DEFAULT_HIDDEN_METRICS;
  }
}

function storeHiddenMetrics(next) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_METRICS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Screen controls are best effort; the live stats keep polling either way.
  }
}

function useRis26Stats() {
  const [payload, setPayload] = useState(EMPTY_STATS);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;

    async function load() {
      try {
        const res = await fetch('/api/ris26', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('stats_failed');
        const data = await res.json();
        if (!cancelled) {
          setPayload({
            ...EMPTY_STATS,
            ...data,
            stats: { ...EMPTY_STATS.stats, ...(data.stats || {}) },
            distribution: Array.isArray(data.distribution) ? data.distribution : [],
            recent: Array.isArray(data.recent) ? data.recent : [],
          });
          setStatus('live');
        }
      } catch {
        if (!cancelled) setStatus('offline');
      } finally {
        if (!cancelled) timeoutId = window.setTimeout(load, REFRESH_MS);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  return { payload, status, setPayload };
}

function useAnimatedDelta(rows) {
  const previousRef = useRef(new Map());
  const rowsWithDelta = useMemo(() => rows.map(row => {
    const previous = previousRef.current.get(row.key);
    return {
      ...row,
      delta: previous == null ? 0 : row.pct - previous,
    };
  }), [rows]);

  useEffect(() => {
    previousRef.current = new Map(rows.map(row => [row.key, row.pct]));
  }, [rows]);

  return rowsWithDelta;
}

function buildPriceRows(distribution, total) {
  if (!total || !Array.isArray(distribution) || distribution.length === 0) return [];
  const ranked = [...distribution]
    .filter(row => Number.isFinite(Number(row.value)) && Number(row.count) > 0)
    .sort((a, b) => Number(b.count) - Number(a.count) || Number(a.value) - Number(b.value));
  const top = ranked.slice(0, 8);
  const topTotal = top.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const rows = top.map(row => ({
    key: String(row.value),
    label: fmt(row.value),
    count: Number(row.count || 0),
    pct: total > 0 ? (Number(row.count || 0) / total) * 100 : 0,
  }));
  if (topTotal < total) {
    rows.push({
      key: 'otros',
      label: 'Otros',
      count: total - topTotal,
      pct: ((total - topTotal) / total) * 100,
    });
  }
  return rows;
}

function deterministicNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function jarInnerRadiusAt(y) {
  if (y < -1.74) return JAR_BOTTOM_RADIUS;
  if (y < -1.28) {
    const t = (y + 1.74) / 0.46;
    return JAR_BOTTOM_RADIUS + t * (JAR_BODY_RADIUS - JAR_BOTTOM_RADIUS);
  }
  if (y < 1.03) return JAR_BODY_RADIUS;
  if (y < 1.56) {
    const t = (y - 1.03) / 0.53;
    return JAR_BODY_RADIUS - t * (JAR_BODY_RADIUS - JAR_MOUTH_RADIUS);
  }
  return JAR_MOUTH_RADIUS;
}

function createPackedBalls(count) {
  const balls = [];
  const r = BALL_MODEL_RADIUS;
  const xStep = r * 2.02;
  const zStep = Math.sqrt(3) * r * 1.01;
  const yStep = Math.sqrt(8 / 3) * r * 0.99;

  for (let layer = 0; balls.length < count && layer < 18; layer += 1) {
    const y = JAR_BOTTOM_Y + r + layer * yStep;
    const availableRadius = Math.max(0.46, jarInnerRadiusAt(y) - r * 1.01);
    const rowLimit = Math.ceil(availableRadius / zStep) + 1;
    const candidates = [];

    for (let row = -rowLimit; row <= rowLimit; row += 1) {
      const z = row * zStep + (layer % 2 ? zStep * 0.34 : 0);
      if (Math.abs(z) > availableRadius) continue;
      const xLimit = Math.sqrt((availableRadius * availableRadius) - (z * z));
      const colLimit = Math.ceil(xLimit / xStep) + 1;

      for (let col = -colLimit; col <= colLimit; col += 1) {
        const x = col * xStep + ((row + layer) % 2 ? xStep * 0.5 : 0);
        if ((x * x) + (z * z) > availableRadius * availableRadius) continue;
        const seed = (layer + 1) * 97 + (row + 19) * 31 + (col + 23) * 13;
        const radial = (x * x) + (z * z);
        candidates.push({
          x,
          y,
          z,
          sortKey: -radial + deterministicNoise(seed) * 0.04,
          seed,
        });
      }
    }

    candidates.sort((a, b) => a.sortKey - b.sortKey);
    for (const candidate of candidates) {
      if (balls.length >= count) break;
      const index = balls.length;
      const jitter = (deterministicNoise(candidate.seed + 41) - 0.5) * r * 0.025;
      const radialDistance = Math.hypot(candidate.x, candidate.z);
      const wallRadius = Math.max(0.01, availableRadius - r * 0.08);
      const outwardRatio = radialDistance > 0.01
        ? Math.min(wallRadius, radialDistance + (wallRadius - radialDistance) * 0.32) / radialDistance
        : 1;
      balls.push({
        key: `ball-${index}`,
        position: [
          candidate.x * outwardRatio + jitter,
          candidate.y + (deterministicNoise(candidate.seed + 71) - 0.5) * r * 0.015,
          candidate.z * outwardRatio + (deterministicNoise(candidate.seed + 103) - 0.5) * r * 0.025,
        ],
        color: BALL_COLORS[(index * 7 + layer * 3) % BALL_COLORS.length],
        rotation: [
          deterministicNoise(index + 3) * Math.PI,
          deterministicNoise(index + 11) * Math.PI,
          deterministicNoise(index + 29) * Math.PI,
        ],
      });
    }
  }

  return balls;
}

function RotatingJarAssembly() {
  const groupRef = useRef(null);
  const balls = useMemo(() => createPackedBalls(BALL_COUNT), []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.22;
  });

  return (
    <group ref={groupRef} position={[0.46, -0.06, -0.76]} rotation={[0, -0.45, 0]} scale={0.88}>
      <JarModel />
      <group>
        {balls.map(ball => (
          <PingPongBall ball={ball} key={ball.key} />
        ))}
      </group>
    </group>
  );
}

function JarModel() {
  const jarProfile = useMemo(() => [
    new THREE.Vector2(0.52, -2.14),
    new THREE.Vector2(0.9, -2.1),
    new THREE.Vector2(1.06, -1.86),
    new THREE.Vector2(1.25, -1.62),
    new THREE.Vector2(JAR_BODY_RADIUS, 1.0),
    new THREE.Vector2(1.16, 1.28),
    new THREE.Vector2(0.9, 1.58),
    new THREE.Vector2(JAR_MOUTH_RADIUS, 1.92),
    new THREE.Vector2(JAR_MOUTH_RADIUS, 2.58),
  ], []);

  return (
    <group>
      <mesh renderOrder={4}>
        <latheGeometry args={[jarProfile, 128]} />
        <meshPhysicalMaterial
          color="#d7fbff"
          depthWrite={false}
          ior={1.45}
          metalness={0}
          opacity={0.28}
          roughness={0.03}
          side={THREE.DoubleSide}
          thickness={0.8}
          transparent
          transmission={0.62}
        />
      </mesh>
      <mesh renderOrder={5}>
        <latheGeometry args={[jarProfile, 48]} />
        <meshBasicMaterial
          color="#e9ffff"
          depthWrite={false}
          opacity={0.15}
          side={THREE.DoubleSide}
          transparent
          wireframe
        />
      </mesh>
      <JarRing y={-2.1} radius={0.9} tube={0.045} opacity={0.36} />
      <JarRing y={-1.86} radius={1.06} tube={0.026} opacity={0.24} />
      <JarRing y={1} radius={JAR_BODY_RADIUS} tube={0.018} opacity={0.18} />
      <JarRing y={1.58} radius={0.9} tube={0.026} opacity={0.34} />
      <JarRing y={1.92} radius={JAR_MOUTH_RADIUS} tube={0.026} opacity={0.42} />
      <JarRing y={2.58} radius={JAR_MOUTH_RADIUS} tube={0.04} opacity={0.54} />
    </group>
  );
}

function JarRing({ y, radius, tube, opacity }) {
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, tube, 18, 128]} />
      <meshPhysicalMaterial
        color="#e9ffff"
        metalness={0}
        opacity={opacity}
        roughness={0.06}
        transparent
      />
    </mesh>
  );
}

function PingPongBall({ ball }) {
  return (
    <group position={ball.position} rotation={ball.rotation}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[BALL_MODEL_RADIUS, 32, 24]} />
        <meshStandardMaterial
          color={ball.color}
          metalness={0}
          roughness={0.78}
        />
      </mesh>
      <mesh>
        <torusGeometry args={[BALL_MODEL_RADIUS * 0.72, BALL_MODEL_RADIUS * 0.006, 8, 42]} />
        <meshBasicMaterial color="#fffbe8" opacity={0.22} transparent />
      </mesh>
    </group>
  );
}

function PingPongJar() {
  return (
    <div className="ris26-jar-scene" aria-label="Modelo 3D de un frasco con pelotas de ping-pong">
      <Canvas
        camera={{ fov: 35, position: [0, 0.26, 8.95] }}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
        shadows
      >
        <color attach="background" args={['#050706']} />
        <ambientLight intensity={1.15} />
        <directionalLight
          castShadow
          intensity={2.1}
          position={[3.6, 5.2, 4.6]}
          shadow-mapSize-height={1024}
          shadow-mapSize-width={1024}
        />
        <pointLight color="#00e87a" intensity={1.7} position={[-3.2, 1.6, 3.6]} />
        <pointLight color="#ff8a34" intensity={1.15} position={[3.5, -0.2, 2.4]} />
        <RotatingJarAssembly />
      </Canvas>
    </div>
  );
}

function PriceBoard({ rows, total }) {
  const animatedRows = useAnimatedDelta(rows);
  if (!total) {
    return (
      <div className="ris26-empty-board">
        <span>Esperando las primeras respuestas</span>
      </div>
    );
  }

  return (
    <div className="ris26-price-board" aria-label="Distribución de respuestas">
      {animatedRows.map(row => (
        <div className="ris26-price-row" key={row.key}>
          <div className="ris26-price-answer">{row.label}</div>
          <div className="ris26-price-track">
            <div
              className="ris26-price-fill"
              style={{ width: `${Math.max(4, Math.min(100, row.pct))}%` }}
            />
          </div>
          <div className="ris26-price-meta">
            <strong>{fmt(row.pct, 1)}%</strong>
            <span className={row.delta > 0.2 ? 'up' : row.delta < -0.2 ? 'down' : ''}>
              {row.delta > 0.2 ? '+' : ''}{fmt(row.delta, 1)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PriceBarChart({ rows, total }) {
  const animatedRows = useAnimatedDelta(rows);
  if (!total) {
    return (
      <div className="ris26-empty-board ris26-empty-chart">
        <span>Esperando las primeras respuestas</span>
      </div>
    );
  }

  return (
    <div className="ris26-bar-chart" aria-label="Gráfica vertical de respuestas">
      {animatedRows.map(row => (
        <div className="ris26-bar-column" key={row.key}>
          <div className="ris26-bar-track">
            <div
              className="ris26-bar-fill"
              style={{ height: `${Math.max(5, Math.min(100, row.pct))}%` }}
            />
          </div>
          <strong>{row.label}</strong>
          <span>{fmt(row.pct, 1)}%</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, hint, hidden = false, onToggle }) {
  return (
    <div className={`ris26-metric ${hidden ? 'is-hidden' : ''}`}>
      <div className="ris26-metric-top">
        <span>{label}</span>
        {onToggle && (
          <button type="button" onClick={onToggle}>
            {hidden ? 'Mostrar' : 'Ocultar'}
          </button>
        )}
      </div>
      <strong>{hidden ? 'Oculto' : value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function GuessForm({ onSubmitted }) {
  const [guess, setGuess] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    const numericGuess = Number(guess);
    if (!Number.isInteger(numericGuess) || numericGuess < 1 || numericGuess > 10000) {
      setError('Pon un número válido.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/ris26', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: numericGuess, displayName }),
      });
      if (!res.ok) throw new Error('submit_failed');
      storeSubmission(numericGuess);
      onSubmitted(numericGuess);
    } catch {
      setError('No pudimos guardar tu respuesta. Intenta otra vez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ris26-form" onSubmit={submit}>
      <div className="ris26-form-kicker">RIS 26 · Demo en vivo</div>
      <h1>{QUESTION}</h1>
      <label>
        <span>Tu predicción</span>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          type="number"
          min="1"
          max="10000"
          value={guess}
          onChange={event => setGuess(event.target.value)}
          placeholder="Ej. 126"
          autoFocus
        />
      </label>
      <label>
        <span>Nombre opcional</span>
        <input
          type="text"
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
          placeholder="Para reconocer tu respuesta"
          maxLength={40}
        />
      </label>
      {error && <div className="ris26-form-error">{error}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Enviando...' : 'Enviar respuesta'}</button>
      <p>No necesitas cuenta. Tu celular queda anónimo.</p>
    </form>
  );
}

function PhoneThanks({ stats }) {
  const total = Number(stats.total || 0);

  return (
    <div className="ris26-phone-results ris26-phone-thanks">
      <div className="ris26-submitted">
        <span>RIS 26 · Demo en vivo</span>
        <h1>Gracias por tu respuesta</h1>
      </div>
      <div className="ris26-phone-average-card">
        <span>Promedio</span>
        <strong>{fmt(stats.mean, 1)}</strong>
        <small>{total ? `${fmt(total)} respuestas en vivo` : 'Esperando más respuestas'}</small>
      </div>
      <div className="ris26-phone-explainer">
        <strong>Cómo se mueve Pronos</strong>
        <span>
          La media de la multitud apunta al valor real. Cada respuesta suma señal:
          cuando más personas se concentran en un número, su precio sube; cuando
          la opinión se dispersa, baja.
        </span>
      </div>
      <a className="ris26-pronos-link" href="/points/">
        Visitar Pronos
      </a>
      <a className="ris26-create-account-link" href="/points/?signup=1">
        Crear cuenta
      </a>
    </div>
  );
}

function RevealResultsDialog({
  open,
  mode,
  unlocked,
  password,
  error,
  busy,
  onClose,
  onPasswordChange,
  onSubmitPassword,
}) {
  if (!open) return null;
  const isReveal = mode === 'reveal';

  return (
    <div className="ris26-modal-backdrop" role="presentation">
      <div
        className="ris26-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ris26-reveal-title"
      >
        <button className="ris26-modal-close" type="button" onClick={onClose}>
          Cerrar
        </button>
        {unlocked && isReveal ? (
          <>
            <span className="ris26-modal-kicker">Resultado final</span>
            <h2 id="ris26-reveal-title">Hay {fmt(BALL_COUNT)} pelotas</h2>
            <p>La cantidad real de pelotas de ping-pong en el frasco es {fmt(BALL_COUNT)}.</p>
          </>
        ) : (
          <form onSubmit={onSubmitPassword}>
            <span className="ris26-modal-kicker">Modo operador</span>
            <h2 id="ris26-reveal-title">
              {isReveal ? 'Contraseña para revelar' : 'Contraseña de operador'}
            </h2>
            <p>
              {isReveal
                ? 'La pantalla pide contraseña antes de mostrar el resultado real.'
                : 'La pantalla pide contraseña antes de cambiar valores visibles.'}
            </p>
            <input
              type="password"
              value={password}
              onChange={event => onPasswordChange(event.target.value)}
              placeholder="Contraseña"
              autoFocus
            />
            {error && <div className="ris26-form-error">{error}</div>}
            <button type="submit" disabled={busy}>
              {busy ? 'Validando...' : isReveal ? 'Revelar resultado' : 'Desbloquear controles'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Ris26Page() {
  const { payload, status, setPayload } = useRis26Stats();
  const [submittedGuess, setSubmittedGuess] = useState(() => readStoredSubmission()?.guess || null);
  const [hiddenMetrics, setHiddenMetrics] = useState(() => readHiddenMetrics());
  const [revealOpen, setRevealOpen] = useState(false);
  const [operatorMode, setOperatorMode] = useState('reveal');
  const [operatorUnlocked, setOperatorUnlocked] = useState(false);
  const [operatorPassword, setOperatorPassword] = useState('');
  const [operatorError, setOperatorError] = useState('');
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [pendingMetricKey, setPendingMetricKey] = useState(null);
  const participate = isParticipantPath();
  const stats = payload.stats || EMPTY_STATS.stats;
  const rows = useMemo(
    () => buildPriceRows(payload.distribution, Number(stats.total || 0)),
    [payload.distribution, stats.total],
  );
  const topRow = rows[0] || null;
  const scanUrl = participantUrl();

  useEffect(() => {
    document.title = 'RIS 26 | Pronos';
  }, []);

  useEffect(() => {
    if (participate) return undefined;
    if (typeof window === 'undefined') return;
    let cancelled = false;
    fetch('/api/demo-access', { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.ok) setOperatorUnlocked(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [participate]);

  useEffect(() => {
    if (!payload.ownGuess?.guess || submittedGuess) return;
    setSubmittedGuess(payload.ownGuess.guess);
    storeSubmission(payload.ownGuess.guess);
  }, [payload.ownGuess?.guess, submittedGuess]);

  async function refreshAfterSubmit(guess) {
    setSubmittedGuess(guess);
    try {
      const res = await fetch('/api/ris26', { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPayload({
          ...EMPTY_STATS,
          ...data,
          stats: { ...EMPTY_STATS.stats, ...(data.stats || {}) },
          distribution: Array.isArray(data.distribution) ? data.distribution : [],
          recent: Array.isArray(data.recent) ? data.recent : [],
        });
      }
    } catch {
      // The polling loop will retry within two seconds.
    }
  }

  function toggleMetric(metricKey) {
    setHiddenMetrics(current => {
      const next = {
        ...current,
        [metricKey]: !current[metricKey],
      };
      storeHiddenMetrics(next);
      return next;
    });
  }

  function requestMetricToggle(metricKey) {
    if (operatorUnlocked) {
      toggleMetric(metricKey);
      return;
    }
    setPendingMetricKey(metricKey);
    setOperatorMode('metrics');
    setOperatorError('');
    setRevealOpen(true);
  }

  function requestReveal() {
    setPendingMetricKey(null);
    setOperatorMode('reveal');
    setOperatorError('');
    setRevealOpen(true);
  }

  function closeOperatorDialog() {
    setRevealOpen(false);
    setPendingMetricKey(null);
    setOperatorPassword('');
    setOperatorError('');
  }

  async function unlockAndReveal(event) {
    event.preventDefault();
    setOperatorBusy(true);
    setOperatorError('');
    try {
      const res = await fetch('/api/demo-access', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: operatorPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Contraseña incorrecta');
      }
      setOperatorUnlocked(true);
      setOperatorPassword('');
      if (operatorMode === 'metrics' && pendingMetricKey) {
        toggleMetric(pendingMetricKey);
        setPendingMetricKey(null);
        setRevealOpen(false);
      }
    } catch (e) {
      setOperatorError(e?.message || 'No se pudo validar la contraseña.');
    } finally {
      setOperatorBusy(false);
    }
  }

  if (participate) {
    return (
      <main className="ris26-page ris26-page-phone">
        {!submittedGuess ? (
          <GuessForm onSubmitted={refreshAfterSubmit} />
        ) : (
          <PhoneThanks stats={stats} />
        )}
      </main>
    );
  }

  const screenMetrics = [
    { key: 'mean', label: 'Promedio', value: fmt(stats.mean, 1), hint: 'respuesta media' },
    { key: 'total', label: 'Participantes', value: fmt(stats.total), hint: 'en vivo' },
    { key: 'range', label: 'Rango', value: stats.total ? `${fmt(stats.min)}–${fmt(stats.max)}` : '—', hint: 'mínimo a máximo' },
    { key: 'leader', label: 'Precio líder', value: topRow ? `${topRow.label} · ${fmt(topRow.pct, 1)}%` : '—', hint: 'según la multitud' },
  ];

  return (
    <main className="ris26-page ris26-page-screen">
      <header className="ris26-screen-header">
        <div className="ris26-brand">PRONOS</div>
        <div className={`ris26-live-pill ${status === 'offline' ? 'offline' : ''}`}>
          <span />
          {status === 'offline' ? 'Reconectando' : 'Resultados en vivo'}
        </div>
      </header>

      <section className="ris26-hero">
        <div className="ris26-stage-title">
          <div className="ris26-kicker">RIS 26 · Demo en vivo</div>
          <h1>{STAGE_QUESTION}</h1>
          <p>{QUESTION}</p>
        </div>
        <div className="ris26-visual-area">
          <div className="ris26-jar-panel">
            <PingPongJar />
          </div>
          <a className="ris26-qr-card ris26-qr-card-stage" href={scanUrl}>
            <div className="ris26-qr-inner">
              <img src={qrUrl(scanUrl)} alt="QR para participar en RIS 26" />
              <span>Escanea para participar</span>
              <strong>pronos.io/ris26/participar</strong>
            </div>
          </a>
        </div>
      </section>

      <section className="ris26-screen-bottom">
        <div className="ris26-chart-panel">
          <div className="ris26-section-head">
            <span>Mercado de respuestas</span>
            <strong>Precio = porcentaje de votos</strong>
          </div>
          <PriceBarChart rows={rows} total={stats.total} />
          <div className="ris26-stats-panel ris26-stats-strip">
            {screenMetrics.map(metric => (
              <Metric
                hidden={hiddenMetrics[metric.key]}
                hint={metric.hint}
                key={metric.key}
                label={metric.label}
                onToggle={() => requestMetricToggle(metric.key)}
                value={metric.value}
              />
            ))}
          </div>
          <div className="ris26-operator-actions">
            <button className="ris26-reveal-button" type="button" onClick={requestReveal}>
              Revelar resultado
            </button>
          </div>
          <div className="ris26-explainer">
            <strong>Cómo se mueve Pronos</strong>
            <span>
              La media de la multitud apunta al valor real. Cada respuesta suma señal:
              cuando más personas se concentran en un número, su precio sube; cuando
              la opinión se dispersa, baja.
            </span>
          </div>
        </div>
      </section>
      <RevealResultsDialog
        busy={operatorBusy}
        error={operatorError}
        mode={operatorMode}
        onClose={closeOperatorDialog}
        onPasswordChange={setOperatorPassword}
        onSubmitPassword={unlockAndReveal}
        open={revealOpen}
        password={operatorPassword}
        unlocked={operatorUnlocked}
      />
    </main>
  );
}
