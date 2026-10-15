import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DOMParser, parseHTML } from 'linkedom';
import { AA_URL, AA_METHODOLOGY_URL, AA_OUTCOMES, RT_URL, RT_OUTCOMES, isAutomaticContract } from './automated-market-rules.js';

export const CUTOFF_KINDS = ['rotten-tomatoes-cutoff', 'artificial-analysis-cutoff', 'openai-astra-release'];
const OPENAI_RSS = 'https://openai.com/news/rss.xml';
const OPENAI_MODELS = 'https://developers.openai.com/api/docs/models';
const CHATGPT_NOTES = 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes';
const hash = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
function prose(node) {
  if (!node || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return '';
  if (node.nodeType === 3) return node.textContent;
  return [...node.childNodes].map(prose).join(' ');
}
export const resultRows = value => Array.isArray(value) ? value : value?.rows || [];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const contractHash = (cfg, outcomes) => hash(JSON.stringify(canonical({ cfg, outcomes })));

export function cutoffReview(reason) {
  return Object.assign(new Error(reason), { benign: true, manualReview: true,
    info: { source: 'official-result', rationale: `No hay evidencia de cierre inequívoca (${reason}). No usar datos posteriores ni estimar el resultado.` } });
}

async function documentAt(url, fetchImpl) {
  let target = new URL(url);
  const host = target.hostname;
  for (let n = 0; n < 4; n++) {
    if (target.protocol !== 'https:' || target.hostname !== host || target.port || target.username || target.password) throw cutoffReview('snapshot_untrusted_redirect');
    const r = await fetchImpl(target.href, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { accept: 'text/html,application/xml', 'user-agent': 'Pronos settlement evidence (+https://pronos.io)' } });
    if ([301, 302, 303, 307, 308].includes(r.status)) { target = new URL(r.headers.get('location'), target); continue; }
    if (!r.ok) throw cutoffReview(`snapshot_http_${r.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of r.body) {
      size += chunk.byteLength;
      if (size > 6_000_000) throw cutoffReview('snapshot_document_too_large');
      chunks.push(chunk);
    }
    const html = Buffer.concat(chunks).toString('utf8');
    if (/just a moment|verify you are human|access denied|captcha challenge/i.test(html.slice(0, 10000))) throw cutoffReview('snapshot_blocked');
    return html;
  }
  throw cutoffReview('snapshot_redirect_limit');
}

export function parseRottenTomatoes(html) {
  const { document: d } = parseHTML(html);
  if (d.querySelector('link[rel="canonical"]')?.getAttribute('href') !== RT_URL
    || clean(d.querySelector('h1')?.textContent) !== 'Street Fighter') throw cutoffReview('rt_movie_identity');
  const movie = [...d.querySelectorAll('script[type="application/ld+json"]')].map(n => JSON.parse(n.textContent)).find(row => row['@type'] === 'Movie');
  const directors = Array.isArray(movie?.director) ? movie.director : [movie?.director];
  if (!directors.some(row => row?.name === 'Kitao Sakurai') || !String(movie?.dateCreated || movie?.datePublished || '').startsWith('2026')) {
    throw cutoffReview('rt_movie_year_or_director');
  }
  const data = JSON.parse(d.querySelector('#media-scorecard-json')?.textContent || '{}');
  const score = data.overlay?.criticsAll;
  const visibleNode = d.querySelector('media-scorecard [slot="critics-score"]');
  const visible = clean(visibleNode?.textContent);
  const panel = d.querySelector('media-scorecard [slot="critics-score-type"]');
  if (!visibleNode || score?.title !== 'Tomatometer' || data.criticsScore?.title !== 'Tomatometer' || clean(panel?.textContent) !== 'Tomatometer'
    || !Number.isInteger(score.reviewCount) || score.reviewCount < 0) throw cutoffReview('rt_missing_critics_panel');
  if ((score.score == null || score.score === '') && (data.criticsScore.score == null || data.criticsScore.score === '') && visible === '') {
    return { state: 'no-score', evidenceUrl: RT_URL, reviewCount: score.reviewCount };
  }
  if (!/^\d{1,3}$/.test(String(score.score)) || Number(score.score) > 100
    || score.score !== data.criticsScore.score || visible !== `${score.score}%` || score.scorePercent !== visible) {
    throw cutoffReview('rt_conflicting_critics_score');
  }
  return { state: 'scored', score: Number(score.score), reviewCount: score.reviewCount, evidenceUrl: RT_URL };
}

export function parseArtificialAnalysis(html, methodology) {
  const { document: d } = parseHTML(html);
  const tables = [...d.querySelectorAll('table')].filter(t => clean(t.querySelector('thead')?.textContent).includes('Artificial Analysis Intelligence Index'));
  const filter = d.querySelector('input[placeholder^="Filter"]');
  if (tables.length !== 1 || !filter || (filter.getAttribute('value') || '') !== '') throw cutoffReview('aa_table_or_filters');
  const headers = [...tables[0].querySelectorAll('thead tr')].at(-1);
  const labels = [...headers.querySelectorAll('th')].map(n => clean(n.textContent));
  if (labels[0] !== 'Model' || labels[2] !== 'Creator' || labels[3] !== 'Artificial Analysis Intelligence Index') throw cutoffReview('aa_columns_changed');
  const rows = [...tables[0].querySelectorAll('tbody tr')].map((tr, i) => {
    const cells = [...tr.querySelectorAll('td')];
    const score = clean(cells[3]?.textContent);
    const slug = cells.at(-1)?.querySelector('a[href^="/models/"]')?.getAttribute('href');
    if (!cells[0] || !clean(cells[2]?.textContent) || !slug || !/^\/models\/[a-z0-9-]+$/.test(slug)
      || !/^(?:\d+(?:\.\d+)?\*?|--)$/.test(score)) throw cutoffReview('aa_invalid_row');
    return { model: clean(cells[0].textContent), creator: clean(cells[2].textContent), slug,
      visibleScore: score, score: score === '--' ? null : Number(score.replace('*', '')), order: i + 1 };
  });
  if (!rows.length || new Set(rows.map(r => r.slug)).size !== rows.length || rows[0].score == null) throw cutoffReview('aa_incomplete_or_duplicate_rows');
  const scores = rows.filter(r => r.score != null);
  if (scores.some((r, i) => i && r.score > scores[i - 1].score)) throw cutoffReview('aa_not_ordered_by_index');
  const faqs = [...d.querySelectorAll('script[type="application/ld+json"]')].map(n => JSON.parse(n.textContent))
    .flatMap(row => row.mainEntity || []);
  const ranked = faqs.find(row => /ranks #1 on the LLM Leaderboard/.test(row.name))?.acceptedAnswer?.text;
  const count = ranked?.match(/out of (\d+) models ranked/);
  const topScore = ranked?.match(/Intelligence Index score of (\d+(?:\.\d+)?)/);
  const nameKey = value => clean(value).toLowerCase().replace(/, default fallback| with fallback/g, ' fallback').replace(/[^a-z0-9]/g, '');
  const topName = ranked?.split(' currently ranks #1')[0];
  if (!count || Number(count[1]) !== rows.filter(r => /^\d+(?:\.\d+)?$/.test(r.visibleScore)).length
    || Number(topScore?.[1]) !== rows[0].score || nameKey(topName) !== nameKey(rows[0].model)) throw cutoffReview('aa_coverage_or_summary_mismatch');
  const { document: m } = parseHTML(methodology);
  const main = m.querySelector('main');
  const version = clean(main?.textContent).match(/Artificial Analysis Intelligence Index v(\d+\.\d+(?:\.\d+)?)/)?.[1];
  if (!version || !main) throw cutoffReview('aa_index_version_missing');
  return { state: 'ranked', leader: rows[0], rows, indexVersion: version,
    methodologyHash: hash(clean(main.textContent)), evidenceUrl: AA_URL, methodologyUrl: AA_METHODOLOGY_URL };
}

export function parseOpenAiFeed(xml, openedAt, cutoff) {
  const d = new DOMParser().parseFromString(xml, 'text/xml');
  const all = [...d.querySelectorAll('item')].map(n => ({ title: clean(n.querySelector('title')?.textContent),
    url: clean(n.querySelector('link')?.textContent), published: new Date(clean(n.querySelector('pubDate')?.textContent)).getTime() }));
  const trusted = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'openai.com'
    && !url.username && !url.password && !url.port && !url.search && !url.hash; } catch { return false; } };
  if (!all.length || all.some(r => !Number.isFinite(r.published) || !trusted(r.url))
    || new Set(all.map(r => r.url)).size !== all.length || !Number.isFinite(Date.parse(openedAt))
    || Math.min(...all.map(r => r.published)) > Date.parse(openedAt)) throw cutoffReview('astra_incomplete_official_feed');
  // Include earlier announcements: a model announced earlier may become publicly accessible during this market.
  const relevant = all.filter(r => r.published >= Date.parse(openedAt) && r.published <= Date.parse(cutoff)
    || /astra/i.test(`${r.title} ${r.url}`) && r.published <= Date.parse(cutoff));
  if (relevant.length > 60) throw cutoffReview('astra_announcement_scan_limit');
  return relevant;
}

export function qualifyingAstraNames(text) {
  return [...String(text).matchAll(/\bGPT[- ](?:(\d+)(?:\.(\d+))?[- ]Astra|Astra[- ](\d+)(?:\.(\d+))?)\b/gi)]
    .filter(m => Number(m[1] || m[3]) > 6 || Number(m[1] || m[3]) === 6 && Number(m[2] || m[4]) >= 1)
    .map(m => m[0]);
}

export function parseAstraEvidence(articles, modelsHtml, notesHtml, { openedAt } = {}) {
  const { document: models } = parseHTML(modelsHtml);
  const { document: notes } = parseHTML(notesHtml);
  const modelMain = models.querySelector('main'); const notesMain = notes.querySelector('article') || notes.querySelector('main');
  if (!modelMain || !/models/i.test(modelMain.textContent) || !notesMain || !/ChatGPT.*Release Notes/i.test(notesMain.textContent)) {
    throw cutoffReview('astra_access_documents_missing');
  }
  const access = clean(`${prose(modelMain)} ${prose(notesMain)}`);
  const nameKey = value => value.toLowerCase().replace(/[- ]/g, '');
  const accessNames = qualifyingAstraNames(access).map(nameKey);
  const matching = articles.filter(r => qualifyingAstraNames(`${r.title} ${r.text}`).length);
  const available = matching.filter(r => {
    const paragraphs = r.paragraphs || [];
    return paragraphs.some(p => qualifyingAstraNames(p).some(name => accessNames.includes(nameKey(name)))
      && /(?:now|today).{0,60}(?:available|rolling out)|available.{0,60}(?:now|today|all (?:users|developers|paid))|all (?:users|developers|paid).{0,60}(?:access|available)/i.test(p)
      && /ChatGPT|API/i.test(p) && !/invite|waitlist|private|coming soon|rename|renaming|formerly|\bnot\b|\bno\b|will be|plans? to|selected users|limited access|small group/i.test(p));
  });
  if (available.length && qualifyingAstraNames(access).length) return { state: 'yes', evidenceUrl: available[0].url,
    model: qualifyingAstraNames(`${available[0].title} ${available[0].text}`)[0], publishedAt: new Date(available[0].published).toISOString() };
  if (matching.length || qualifyingAstraNames(access).length) throw cutoffReview('astra_release_or_access_ambiguous');
  // Unknown Astra successors are never silently interpreted as No.
  if (articles.some(r => /astra/i.test(`${r.title} ${r.text}`) && /successor|next.generation|renam/i.test(`${r.title} ${r.text}`))) {
    throw cutoffReview('astra_ambiguous_successor');
  }
  if (openedAt) {
    const dates = [...notesMain.querySelectorAll('h2,h3,h4')].map(n => clean(n.textContent))
      .filter(value => /^[A-Z][a-z]+ \d{1,2},? 20\d{2}$/.test(value)).map(Date.parse).filter(Number.isFinite);
    if (!dates.length || Math.min(...dates) > Date.parse(openedAt)) throw cutoffReview('astra_incomplete_release_notes');
  }
  return { state: 'no', evidenceUrl: OPENAI_RSS, checkedAnnouncements: articles.map(r => r.url),
    accessUrls: [OPENAI_MODELS, CHATGPT_NOTES] };
}

export async function collectCutoffEvidence(cfg, { fetchImpl = fetch, clock = () => new Date() } = {}) {
  if (!isAutomaticContract(cfg)) throw cutoffReview('snapshot_contract_invalid_or_modified');
  const startedAt = clock().toISOString();
  const documents = [];
  const archive = [];
  const get = async url => {
    const body = await documentAt(url, fetchImpl);
    documents.push({ url, sha256: hash(body) });
    archive.push({ url, bodyGzipBase64: gzipSync(body).toString('base64') });
    return body;
  };
  let result;
  if (cfg.kind === 'rotten-tomatoes-cutoff') result = parseRottenTomatoes(await get(RT_URL));
  else if (cfg.kind === 'artificial-analysis-cutoff') {
    const methodology = await get(AA_METHODOLOGY_URL);
    const html = await get(AA_URL);
    // A methodology change during capture invalidates this bundle.
    const methodologyText = value => clean(parseHTML(value).document.querySelector('main')?.textContent);
    if (methodologyText(methodology) !== methodologyText(await get(AA_METHODOLOGY_URL))) throw cutoffReview('aa_methodology_changed_during_capture');
    result = parseArtificialAnalysis(html, methodology);
  } else if (cfg.kind === 'openai-astra-release') {
    const entries = parseOpenAiFeed(await get(OPENAI_RSS), cfg.openedAt, cfg.cutoff);
    const articles = [];
    // Bounded batches keep complete announcement coverage feasible inside the closing minute.
    for (let offset = 0; offset < entries.length; offset += 4) {
      const batch = await Promise.all(entries.slice(offset, offset + 4).map(async entry => {
        const { document: d } = parseHTML(await get(entry.url));
        const main = d.querySelector('article') || d.querySelector('main');
        if (!main || !clean(main.textContent)) throw cutoffReview('astra_announcement_unreadable');
        return { ...entry, text: clean(prose(main)), paragraphs: [...main.querySelectorAll('p')].map(n => clean(prose(n))) };
      }));
      articles.push(...batch);
    }
    result = parseAstraEvidence(articles, await get(OPENAI_MODELS), await get(CHATGPT_NOTES), { openedAt: cfg.openedAt });
  } else throw new Error('unsupported_cutoff_kind');
  const capturedAt = clock().toISOString();
  if (Date.parse(capturedAt) < Date.parse(startedAt)) throw cutoffReview('snapshot_clock_reversed');
  return { payload: { ...result, startedAt, capturedAt, documents }, archive };
}

export async function readCutoffResult(cfg, outcomes, { sql, marketId, now = new Date() } = {}) {
  if (!sql || !Number.isInteger(Number(marketId)) || Number(marketId) <= 0) throw cutoffReview('snapshot_store_unavailable');
  if (!CUTOFF_KINDS.includes(cfg.kind) || !isAutomaticContract(cfg)) throw cutoffReview('snapshot_contract_invalid_or_modified');
  const expected = cfg.kind === 'rotten-tomatoes-cutoff' ? RT_OUTCOMES : cfg.kind === 'artificial-analysis-cutoff' ? AA_OUTCOMES : ['Sí', 'No'];
  if (JSON.stringify(outcomes) !== JSON.stringify(expected)) throw cutoffReview('snapshot_outcomes_mismatch');
  const maxAge = cfg.kind === 'artificial-analysis-cutoff' ? 300000 : 60000;
  if (now.getTime() < Date.parse(cfg.cutoff)) throw Object.assign(new Error('snapshot_not_due'), { benign: true });
  const rows = resultRows(await sql.query(`SELECT payload, started_at, captured_at FROM points_official_result_snapshots
    WHERE market_id = $1 AND contract_hash = $2 AND captured_at <= $3::timestamptz
      AND started_at >= $3::timestamptz - ($4 * INTERVAL '1 millisecond')
    ORDER BY captured_at DESC, id DESC LIMIT 1`, [Number(marketId), contractHash(cfg, outcomes), cfg.cutoff, maxAge]));
  const row = rows[0]; const payload = typeof row?.payload === 'string' ? JSON.parse(row.payload) : row?.payload;
  if (!payload || Date.parse(payload.startedAt) < Date.parse(cfg.cutoff) - maxAge
    || Date.parse(payload.capturedAt) > Date.parse(cfg.cutoff) || Date.parse(payload.startedAt) > Date.parse(payload.capturedAt)
    || !Number.isFinite(Date.parse(payload.startedAt)) || !Number.isFinite(Date.parse(payload.capturedAt))
    || Date.parse(row.started_at) !== Date.parse(payload.startedAt) || Date.parse(row.captured_at) !== Date.parse(payload.capturedAt)) throw cutoffReview('snapshot_missing_or_stale');
  let winningIdx;
  if (cfg.kind === 'rotten-tomatoes-cutoff') {
    if (payload.state === 'no-score') return { cancel: true, resolverInfo: { ...payload, source: 'official-result', kind: cfg.kind, contractHash: contractHash(cfg, outcomes) } };
    if (payload.state !== 'scored' || !Number.isInteger(payload.score) || payload.score < 0 || payload.score > 100) throw cutoffReview('rt_snapshot_invalid');
    winningIdx = payload.score <= 45 ? 0 : Math.min(10, Math.ceil((payload.score - 45) / 5));
  } else if (cfg.kind === 'artificial-analysis-cutoff') {
    if (payload.state !== 'ranked' || !payload.leader?.creator || !payload.indexVersion) throw cutoffReview('aa_snapshot_invalid');
    const aliases = { OpenAI: 'OpenAI', Google: 'Google', Anthropic: 'Anthropic', xAI: 'xAI', SpaceXAI: 'xAI', Meta: 'Meta' };
    winningIdx = outcomes.indexOf(aliases[payload.leader.creator] || 'Otro');
  } else {
    if (!['yes', 'no'].includes(payload.state)) throw cutoffReview('astra_snapshot_invalid');
    winningIdx = payload.state === 'yes' ? 0 : 1;
  }
  return { winningIdx, resolverInfo: { source: 'official-result', kind: cfg.kind, ...payload,
    rows: undefined, contractHash: contractHash(cfg, outcomes) } };
}
