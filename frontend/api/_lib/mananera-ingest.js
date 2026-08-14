import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import {
  MANANERA_TRANSCRIPT_SOURCE,
  findMananeraTranscript,
} from './mananera.js';

export const MANANERA_PARSE_VERSION = 1;
export const MANANERA_TIME_ZONE = 'America/Mexico_City';

const SPEAKER_RE = /^\s*([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 ,.\-'’«»()]{4,90}?):\s*/gm;
const BLOCK_TAG_RE = /<(br|p|div|li|h[1-6]|section|article|tr|td|th)\b[^>]*>/gi;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (raw, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : raw;
    })
    .replace(/&#x([0-9a-f]+);/gi, (raw, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : raw;
    });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rowsFromResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function datePartsInMexicoCity(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANANERA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    dateYmd: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour === '24' ? '0' : map.hour),
    weekday: map.weekday,
  };
}

function weekdayForMexicoDate(dateYmd) {
  return datePartsInMexicoCity(new Date(`${dateYmd}T12:00:00.000Z`)).weekday;
}

function addDays(dateYmd, days) {
  const [year, month, day] = String(dateYmd || '').split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return d.toISOString().slice(0, 10);
}

export function mexicoCityDateYmd(now = new Date()) {
  return datePartsInMexicoCity(now).dateYmd;
}

export function isMexicoBusinessDay(dateYmd) {
  const weekday = weekdayForMexicoDate(dateYmd);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

export function shouldRunMananeraAttempt(now = new Date()) {
  const parts = datePartsInMexicoCity(now);
  return isMexicoBusinessDay(parts.dateYmd) && [12, 15, 18, 21].includes(parts.hour);
}

export function previousBusinessDates(dateYmd, count = 2) {
  const out = [];
  let cursor = dateYmd;
  while (out.length < count) {
    if (isMexicoBusinessDay(cursor)) out.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return out;
}

export async function fetchWithRetry(fetchImpl, url, options = {}, {
  retries = 3,
  timeoutMs = 30_000,
  backoffMs = 500,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller ? controller.signal : options.signal,
      });
      if (timer) clearTimeout(timer);
      if (response?.status >= 500 && attempt < retries) {
        await sleep(backoffMs * (2 ** (attempt - 1)));
        continue;
      }
      return response;
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastError = err;
      if (attempt >= retries) throw err;
      await sleep(backoffMs * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error('fetch_failed');
}

export function cleanMananeraHtml(html) {
  const withBreaks = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(BLOCK_TAG_RE, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities(withBreaks)
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function trimToMananeraTranscript(text) {
  const raw = String(text || '');
  const idx = raw.indexOf('PRESIDENTA DE MÉXICO');
  return (idx >= 0 ? raw.slice(idx) : raw).trim();
}

export function parseMananeraTurns(transcriptText) {
  const text = String(transcriptText || '').replace(/\r/g, '').trim();
  const turns = [];
  let current = null;
  let match;
  SPEAKER_RE.lastIndex = 0;

  while ((match = SPEAKER_RE.exec(text))) {
    if (current) {
      const body = text.slice(current.bodyStart, match.index).trim();
      if (body) {
        turns.push({
          orden: turns.length + 1,
          hablante: current.speaker,
          texto: body,
        });
      }
    }
    current = {
      speaker: match[1].replace(/\s+/g, ' ').trim(),
      bodyStart: SPEAKER_RE.lastIndex,
    };
  }

  if (current) {
    const body = text.slice(current.bodyStart).trim();
    if (body) {
      turns.push({
        orden: turns.length + 1,
        hablante: current.speaker,
        texto: body,
      });
    }
  }

  return turns;
}

export function buildMananeraParsedRecord({
  dateYmd,
  source = MANANERA_TRANSCRIPT_SOURCE,
  url,
  fetchedAt = new Date().toISOString(),
  html,
}) {
  const cleaned = cleanMananeraHtml(html);
  const transcriptText = trimToMananeraTranscript(cleaned);
  const turns = parseMananeraTurns(transcriptText);
  if (turns.length === 0) {
    const err = new Error('mananera_parse_empty');
    err.code = 'mananera_parse_empty';
    throw err;
  }
  const speakers = [...new Set(turns.map(turn => turn.hablante))];
  const words = transcriptText.split(/\s+/).filter(Boolean).length;
  return {
    dateYmd,
    source,
    url,
    fetchedAt,
    rawHtml: String(html || ''),
    transcriptText,
    characters: transcriptText.length,
    words,
    nTurnos: turns.length,
    speakers,
    turns,
    parseVersion: MANANERA_PARSE_VERSION,
    complete: true,
  };
}

export function normalizeMananeraTranscriptRow(row) {
  if (!row) return null;
  return {
    dateYmd: String(row.date_ymd || row.dateYmd || '').slice(0, 10),
    source: row.source,
    url: row.url,
    fetchedAt: row.fetched_at || row.fetchedAt,
    rawHtmlSha256: row.raw_html_sha256 || null,
    rawHtmlBytes: Number(row.raw_html_bytes || 0),
    transcriptText: row.transcript_text || row.transcriptText || '',
    characters: Number(row.characters || 0),
    words: Number(row.words || 0),
    nTurnos: Number(row.n_turnos || row.nTurnos || 0),
    speakers: parseJsonb(row.speakers, []),
    turns: parseJsonb(row.turns, []),
    parseVersion: Number(row.parse_version || MANANERA_PARSE_VERSION),
    complete: row.complete !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function readStoredMananeraTranscript(db, dateYmd) {
  const result = await db.query(
    `SELECT date_ymd::text AS date_ymd,
            source,
            url,
            fetched_at,
            raw_html_sha256,
            raw_html_bytes,
            transcript_text,
            characters,
            words,
            n_turnos,
            speakers,
            turns,
            parse_version,
            complete,
            created_at,
            updated_at
       FROM points_mananera_transcripts
      WHERE date_ymd = $1::date
        AND complete = true
      LIMIT 1`,
    [dateYmd],
  );
  return normalizeMananeraTranscriptRow(rowsFromResult(result)[0]);
}

export async function persistMananeraTranscript(db, record) {
  const rawHtml = String(record.rawHtml || '');
  const rawBuffer = Buffer.from(rawHtml, 'utf8');
  const compressed = gzipSync(rawBuffer);
  const sha = createHash('sha256').update(rawBuffer).digest('hex');
  const result = await db.query(
    `INSERT INTO points_mananera_transcripts (
       date_ymd,
       source,
       url,
       fetched_at,
       raw_html_gzip,
       raw_html_sha256,
       raw_html_bytes,
       transcript_text,
       characters,
       words,
       n_turnos,
       speakers,
       turns,
       parse_version,
       complete,
       updated_at
     )
     VALUES (
       $1::date, $2, $3, $4::timestamptz, $5, $6, $7,
       $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, true, NOW()
     )
     ON CONFLICT (date_ymd) DO UPDATE SET
       source = EXCLUDED.source,
       url = EXCLUDED.url,
       fetched_at = EXCLUDED.fetched_at,
       raw_html_gzip = EXCLUDED.raw_html_gzip,
       raw_html_sha256 = EXCLUDED.raw_html_sha256,
       raw_html_bytes = EXCLUDED.raw_html_bytes,
       transcript_text = EXCLUDED.transcript_text,
       characters = EXCLUDED.characters,
       words = EXCLUDED.words,
       n_turnos = EXCLUDED.n_turnos,
       speakers = EXCLUDED.speakers,
       turns = EXCLUDED.turns,
       parse_version = EXCLUDED.parse_version,
       complete = true,
       updated_at = NOW()
     RETURNING date_ymd::text AS date_ymd,
               source,
               url,
               fetched_at,
               raw_html_sha256,
               raw_html_bytes,
               transcript_text,
               characters,
               words,
               n_turnos,
               speakers,
               turns,
               parse_version,
               complete,
               created_at,
               updated_at`,
    [
      record.dateYmd,
      record.source,
      record.url,
      record.fetchedAt,
      compressed,
      sha,
      rawBuffer.length,
      record.transcriptText,
      record.characters,
      record.words,
      record.nTurnos,
      JSON.stringify(record.speakers || []),
      JSON.stringify(record.turns || []),
      record.parseVersion || MANANERA_PARSE_VERSION,
    ],
  );
  return normalizeMananeraTranscriptRow(rowsFromResult(result)[0]);
}

export async function missingConsecutiveMananeraDates(db, dateYmd, count = 2) {
  const dates = previousBusinessDates(dateYmd, count);
  const result = await db.query(
    `SELECT date_ymd::text AS date_ymd
       FROM points_mananera_transcripts
      WHERE date_ymd = ANY($1::date[])
        AND complete = true`,
    [dates],
  );
  const found = new Set(rowsFromResult(result).map(row => String(row.date_ymd).slice(0, 10)));
  return dates.filter(day => !found.has(day));
}

export async function ingestMananeraForDate(db, {
  dateYmd = mexicoCityDateYmd(),
  force = false,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  if (!db?.query) throw new Error('mananera_ingest_missing_db');
  if (!dateYmd) throw new Error('mananera_ingest_missing_date');

  if (!force) {
    const existing = await readStoredMananeraTranscript(db, dateYmd);
    if (existing?.complete) {
      return {
        ok: true,
        ready: true,
        skipped: true,
        reason: 'already_ingested',
        dateYmd,
        networkRequests: 0,
        transcript: existing,
      };
    }
  }

  let networkRequests = 0;
  const resilientFetch = async (url, options) => {
    networkRequests += 1;
    return fetchWithRetry(fetchImpl, url, options);
  };

  const transcript = await findMananeraTranscript({
    dateYmd,
    fetchImpl: resilientFetch,
    includeRawHtml: true,
  });

  if (!transcript.ready) {
    return {
      ok: true,
      ready: false,
      skipped: true,
      reason: transcript.reason || 'official_transcript_not_found',
      dateYmd,
      networkRequests,
      directUrl: transcript.directUrl || null,
      archiveUrl: transcript.archiveUrl || null,
      searchUrl: transcript.searchUrl || null,
    };
  }

  const parsed = buildMananeraParsedRecord({
    dateYmd,
    source: transcript.source || MANANERA_TRANSCRIPT_SOURCE,
    url: transcript.url,
    fetchedAt: now.toISOString(),
    html: transcript.html,
  });
  const saved = await persistMananeraTranscript(db, parsed);
  return {
    ok: true,
    ready: true,
    skipped: false,
    reason: 'ingested',
    dateYmd,
    networkRequests,
    transcript: saved,
  };
}
