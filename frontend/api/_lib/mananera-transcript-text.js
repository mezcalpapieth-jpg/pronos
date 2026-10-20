// Shared validation for live reads and cached official Mañanera transcripts.
const SPEAKER_RE = /^\s*([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 ,.\-'’«»()]{4,180}?):[ \t]*/gm;
const END_RE = /^[—–-][ \t]*000[ \t]*[—–-][ \t]*$/m;
const CONTINUES_RE = /(?:^|\n)\s*\(?\s*CONTIN[UÚ]A\s*[.…]+\s*\)?\s*(?:\n|$)/i;

function decodeCodePoint(raw, code) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code) : raw;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (raw, code) => decodeCodePoint(raw, Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (raw, code) => decodeCodePoint(raw, Number.parseInt(code, 16)));
}

export function cleanMananeraHtml(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<\/?(?:br|p|div|li|h[1-6]|section|article|tr|td|th)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    // The existing reader fallback returns Markdown, including bold labels
    // around entire reporter questions as well as around speaker names.
    .replace(/[*_]+/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function trimToMananeraTranscript(text) {
  const raw = String(text || '');
  const start = raw.search(/^PRESIDENTA(?: DE M[ÉE]XICO| CLAUDIA SHEINBAUM)/m);
  const body = (start >= 0 ? raw.slice(start) : raw).trim();
  const end = END_RE.exec(body);
  return end ? body.slice(0, end.index + end[0].length).trim() : body;
}

export function parseMananeraTurns(transcriptText) {
  const text = String(transcriptText || '').replace(/\r/g, '').trim();
  const labels = [...text.matchAll(new RegExp(SPEAKER_RE))];
  return labels.flatMap((label, i) => {
    const charStart = label.index + label[0].length;
    const charEnd = labels[i + 1]?.index ?? text.length;
    const body = text.slice(charStart, charEnd).trim();
    return body ? [{
      orden: i + 1,
      hablante: label[1].replace(/\s+/g, ' ').trim(),
      texto: body,
      charStart,
      charEnd,
    }] : [];
  });
}

export function isMananeraPresident(speaker) {
  const name = String(speaker || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  return /^(?:presidenta(?: constitucional)?(?: de mexico| de los estados unidos mexicanos)?(?:,? claudia sheinbaum pardo)?|claudia sheinbaum pardo)$/.test(name);
}

export function analyzeMananeraTranscript(input) {
  const transcriptText = trimToMananeraTranscript(cleanMananeraHtml(input));
  const turns = parseMananeraTurns(transcriptText);
  const presidentTurns = turns.filter(turn => isMananeraPresident(turn.hablante));
  const reason = !presidentTurns.length ? 'president_speaker_attribution_unavailable'
    : CONTINUES_RE.test(transcriptText) || !END_RE.test(transcriptText)
      ? 'official_transcript_incomplete' : null;
  return { complete: !reason, reason, transcriptText, turns, presidentTurns };
}
