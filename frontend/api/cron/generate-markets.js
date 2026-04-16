import { neon } from '@neondatabase/serverless';

/**
 * Daily market generation pipeline.
 *
 * Runs on a Vercel cron (see vercel.json). Flow:
 *   1. Fetch trending headlines from Google News RSS for MX, LATAM, US, WORLD
 *   2. Ask Claude to generate 4-6 prediction market questions per region in Spanish
 *   3. Insert each as `status='pending'` into `generated_markets` for admin review
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  (required — endpoint is a no-op if missing)
 *   DATABASE_URL       (required)
 *   CRON_SECRET        (optional — if set, request must carry ?key= or Authorization)
 */

const sql = neon(process.env.DATABASE_URL);

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 4096;

// Google News RSS — free, no key required
const NEWS_FEEDS = [
  { region: 'mexico', url: 'https://news.google.com/rss?hl=es-419&gl=MX&ceid=MX:es-419', label: 'MÉXICO & CDMX' },
  { region: 'latam',  url: 'https://news.google.com/rss?hl=es-419&gl=US&ceid=US:es-419', label: 'LATAM' },
  { region: 'us',     url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',     label: 'USA' },
  { region: 'world',  url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en&topic=w', label: 'MUNDO' },
];

const SYSTEM_PROMPT = `Eres un experto en mercados de predicción estilo Polymarket, enfocado en Latinoamérica.
Tu tarea: generar preguntas de mercados de predicción en español a partir de titulares reales.

REGLAS ESTRICTAS:
- Cada pregunta debe tener un evento objetivamente verificable con una fecha de resolución clara
- NO generar mercados sobre temas sensibles (muertes, violencia gráfica, menores, salud individual)
- Preferir temas: política, deportes, cultura, tecnología, economía, crypto, entretenimiento
- Cada pregunta debe tener 2 opciones (Sí/No) o 3 opciones si es una elección entre alternativas claras
- Las probabilidades deben sumar 100 y reflejar tu estimación basada en los titulares
- La pregunta debe empezar con ¿ y terminar con ?
- La fecha límite debe estar entre 7 días y 12 meses en el futuro

DEVUELVE SOLO JSON VÁLIDO con este formato exacto:
{
  "markets": [
    {
      "title": "¿Pregunta del mercado?",
      "icon": "🏛️",
      "deadline": "30 Jun 2026",
      "deadline_iso": "2026-06-30",
      "options": [
        { "label": "Sí", "pct": 45 },
        { "label": "No", "pct": 55 }
      ],
      "reasoning": "Breve explicación de por qué este mercado es interesante y cómo se derivó la probabilidad"
    }
  ]
}`;

// ── Helpers ──────────────────────────────────────────────────────

async function fetchHeadlines(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'PronosBot/1.0 (+https://pronos.io)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    // Simple RSS parse — extract <title> inside <item>
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
    let match;
    while ((match = itemRegex.exec(xml)) && items.length < 15) {
      const t = titleRegex.exec(match[1]);
      if (t && t[1]) items.push(t[1].trim());
    }
    return items;
  } catch (e) {
    console.error(`[generate-markets] Failed to fetch ${feed.region}:`, e.message);
    return [];
  }
}

async function callClaude(headlines, feed) {
  const userPrompt = `Genera 4-6 mercados de predicción a partir de estos titulares de ${feed.label} (${new Date().toLocaleDateString('es-MX')}):\n\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nDevuelve SOLO el JSON con la estructura indicada.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Extract JSON (Claude may wrap it in ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  const parsed = JSON.parse(jsonMatch[0]);
  return { parsed, raw: data };
}

function slugify(title, region) {
  const base = title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,:;"']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const stamp = Date.now().toString(36).slice(-4);
  return `gen-${region}-${base}-${stamp}`;
}

function mapCategory(region) {
  if (region === 'mexico') return 'mexico';
  if (region === 'latam') return 'politica';
  if (region === 'us') return 'politica';
  if (region === 'world') return 'politica';
  return 'general';
}

// ── Handler ──────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CRON_SECRET is mandatory on any Vercel deploy. This endpoint hits the
  // Anthropic API (burns credits) and writes to the database, so it must not
  // be triggerable without the shared secret.
  const cronSecret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!cronSecret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    // Local dev falls through.
  } else {
    const auth = req.headers.authorization || '';
    const key = req.query.key;
    if (auth !== `Bearer ${cronSecret}` && key !== cronSecret) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({
      ok: false,
      reason: 'ANTHROPIC_API_KEY not set — pipeline ready but inactive.',
      note: 'Add the key to Vercel env vars to activate daily generation.',
    });
  }

  const summary = { generated: 0, inserted: 0, errors: [], byRegion: {} };

  for (const feed of NEWS_FEEDS) {
    try {
      const headlines = await fetchHeadlines(feed);
      if (headlines.length === 0) {
        summary.errors.push({ region: feed.region, error: 'No headlines fetched' });
        continue;
      }

      const { parsed, raw } = await callClaude(headlines, feed);
      const markets = Array.isArray(parsed.markets) ? parsed.markets : [];
      summary.generated += markets.length;

      let insertedForRegion = 0;
      for (const m of markets) {
        if (!m.title || !Array.isArray(m.options) || m.options.length < 2) continue;

        // Basic sanity: probabilities should sum to ~100
        const sum = m.options.reduce((s, o) => s + (Number(o.pct) || 0), 0);
        if (sum < 90 || sum > 110) continue;

        const slug = slugify(m.title, feed.region);
        const deadlineDate = m.deadline_iso || null;

        try {
          await sql`
            INSERT INTO generated_markets (
              slug, title, category, category_label, icon,
              deadline, deadline_date, options, volume, region,
              reasoning, source_headlines, model, raw_response, status
            ) VALUES (
              ${slug}, ${m.title}, ${mapCategory(feed.region)}, ${feed.label}, ${m.icon || '📰'},
              ${m.deadline || ''}, ${deadlineDate}, ${JSON.stringify(m.options)}, '0', ${feed.region},
              ${m.reasoning || ''}, ${JSON.stringify(headlines.slice(0, 10))}, ${MODEL}, ${JSON.stringify(raw)}, 'pending'
            )
            ON CONFLICT (slug) DO NOTHING
          `;
          insertedForRegion++;
          summary.inserted++;
        } catch (e) {
          summary.errors.push({ region: feed.region, slug, error: e.message });
        }
      }
      summary.byRegion[feed.region] = { headlines: headlines.length, generated: markets.length, inserted: insertedForRegion };
    } catch (e) {
      summary.errors.push({ region: feed.region, error: e.message });
    }
  }

  return res.status(200).json({ ok: true, ...summary, runAt: new Date().toISOString() });
}
