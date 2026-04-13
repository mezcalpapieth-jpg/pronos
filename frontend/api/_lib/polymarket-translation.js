const POLYMARKET_BASE = 'https://polymarket.com';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_TRANSLATION_MODEL || 'claude-haiku-4-5-20251001';

const HTML_ENTITIES = {
  aacute: '\u00e1',
  eacute: '\u00e9',
  iacute: '\u00ed',
  oacute: '\u00f3',
  uacute: '\u00fa',
  ntilde: '\u00f1',
  Aacute: '\u00c1',
  Eacute: '\u00c9',
  Iacute: '\u00cd',
  Oacute: '\u00d3',
  Uacute: '\u00da',
  Ntilde: '\u00d1',
  copy: '\u00a9',
  reg: '\u00ae',
  mdash: '\u2014',
  ndash: '\u2013',
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_ENTITIES[name] || match)
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractContentAttr(tag) {
  const match = tag.match(/\scontent=(["'])([\s\S]*?)\1/i);
  return match ? decodeHtml(match[2]) : null;
}

function cleanPolymarketTitle(value) {
  return decodeHtml(value)
    .replace(/\s+\|\s+Polymarket.*$/i, '')
    .replace(/\s+Prediction Market.*$/i, '')
    .replace(/\s+Predicciones.*$/i, '')
    .trim();
}

function hasSpanishSignal(value) {
  const text = ` ${normalize(value)} `;
  return (
    /[¿¡áéíóúñ]/i.test(value || '') ||
    /\b(el|la|los|las|un|una|de|del|en|antes|despues|ganador|elecciones|acuerdo|petroleo|estados unidos|sube|baja|si)\b/.test(text)
  );
}

function isUsableSpanishTitle(candidate, englishTitle) {
  const title = cleanPolymarketTitle(candidate);
  if (!title || title.length < 4) return false;
  if (/^polymarket$/i.test(title)) return false;
  if (normalize(title) === normalize(englishTitle) && !hasSpanishSignal(title)) return false;
  return true;
}

function extractSpanishTitle(html, englishTitle) {
  const candidates = [];
  for (const match of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
    candidates.push(stripTags(match[1]));
  }
  for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)=(["'])(?:og:title|twitter:title)\1[^>]*>/gi)) {
    candidates.push(extractContentAttr(match[0]));
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) candidates.push(stripTags(titleMatch[1]));

  for (const candidate of candidates) {
    if (isUsableSpanishTitle(candidate, englishTitle)) {
      return cleanPolymarketTitle(candidate);
    }
  }
  return null;
}

function translateKnownOption(label) {
  const text = normalize(label);
  const dictionary = new Map([
    ['yes', 'S\u00ed'],
    ['no', 'No'],
    ['up', 'Arriba'],
    ['down', 'Abajo'],
    ['above', 'Por encima'],
    ['below', 'Por debajo'],
    ['over', 'Por encima'],
    ['under', 'Por debajo'],
    ['draw', 'Empate'],
    ['tie', 'Empate'],
    ['other', 'Otro'],
    ['none', 'Ninguno'],
    ['no change', 'Sin cambios'],
  ]);
  return dictionary.get(text) || label;
}

function localizeOptions(options) {
  const safeOptions = Array.isArray(options) ? options : [];
  return safeOptions.map(opt => ({
    ...opt,
    label: translateKnownOption(opt?.label || ''),
  }));
}

async function fetchSpanishPage({ slug, eventSlug }) {
  const slugs = Array.from(new Set([eventSlug, slug].filter(Boolean)));
  const urls = [];
  if (eventSlug && slug && eventSlug !== slug) {
    urls.push(`${POLYMARKET_BASE}/es/event/${encodeURIComponent(eventSlug)}/${encodeURIComponent(slug)}`);
  }
  for (const candidate of slugs) {
    const safeSlug = encodeURIComponent(candidate);
    urls.push(`${POLYMARKET_BASE}/es/event/${safeSlug}`);
    urls.push(`${POLYMARKET_BASE}/es/market/${safeSlug}`);
  }
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7',
          'User-Agent': 'pronos.io/1.0 translation-cache',
        },
      });
      if (res.ok) {
        const html = await res.text();
        if (html) return html;
      }
    } catch (_) {
      // Try the next public route, then fall back to Anthropic.
    }
  }
  return null;
}

export async function translateFromPolymarketSpanish({ slug, eventSlug, title, options }) {
  if (!slug || !title) return null;
  const html = await fetchSpanishPage({ slug, eventSlug });
  if (!html) return null;
  const titleEs = extractSpanishTitle(html, title);
  if (!titleEs) return null;
  return {
    titleEs,
    optionsEs: localizeOptions(options),
    source: 'polymarket',
  };
}

export async function translateWithAnthropic({ title, options }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const safeOptions = Array.isArray(options) ? options : [];
  const labels = safeOptions.map(o => o?.label || '').filter(Boolean);

  const prompt = `Translate this Polymarket prediction market question and its outcome labels to natural, conversational Spanish (Mexican Spanish preferred). Preserve names of people, teams, and places — only translate the surrounding text. Keep the question concise.

Question: ${title}
Options: ${JSON.stringify(labels)}

Respond with ONLY valid JSON in this exact format (no markdown, no commentary):
{"title": "<spanish question>", "options": ["<opt1>", "<opt2>", ...]}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.title || !Array.isArray(parsed.options)) return null;

    const optionsEs = safeOptions.map((opt, i) => ({
      ...opt,
      label: parsed.options[i] || opt.label,
    }));
    return { titleEs: parsed.title, optionsEs, source: 'anthropic' };
  } catch (_) {
    return null;
  }
}

export async function translateMarketToSpanish({ slug, eventSlug, title, options }) {
  const polymarket = await translateFromPolymarketSpanish({ slug, eventSlug, title, options });
  if (polymarket) return polymarket;
  return translateWithAnthropic({ title, options });
}
