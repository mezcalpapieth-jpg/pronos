import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { parseRottenTomatoes, parseArtificialAnalysis, qualifyingAstraNames, parseAstraEvidence, parseOpenAiFeed,
  collectCutoffEvidence, readCutoffResult, contractHash } from './official-cutoff-snapshots.js';
import { automaticConfig, RT_URL, RT_OUTCOMES, AA_OUTCOMES } from './automated-market-rules.js';

export function rtPage(score = '45') {
  const critics = { title: 'Tomatometer', reviewCount: 10, ...(score == null ? {} : { score, scorePercent: `${score}%` }) };
  return `<link rel="canonical" href="${RT_URL}"><h1>Street Fighter</h1>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', dateCreated: '2026', director: { name: 'Kitao Sakurai' } })}</script>
    <media-scorecard><rt-text slot="critics-score">${score == null ? '' : `${score}%`}</rt-text><rt-text slot="critics-score-type">Tomatometer</rt-text>
    <rt-text slot="audience-score">99%</rt-text></media-scorecard>
    <script id="media-scorecard-json">${JSON.stringify({ criticsScore: critics, overlay: { criticsAll: critics, criticsTop: { score: '95' } } })}</script>`;
}
const methodology = '<main><h1>Artificial Analysis Intelligence Index v4.3.2</h1></main>';
export function aaPage({ score = 58, second = 58, creator = 'Anthropic', count = 2 } = {}) {
  const rows = [['Claude Opus 5.5 (max)', creator, score, 'opus-max'], ['GPT-6 Astra', 'OpenAI', second, 'gpt-6-astra']];
  return `<input placeholder="Filter, e.g. GPT, Meta" value=""><table><thead><tr><th>Model</th><th>Context Window</th><th>Creator</th><th>Artificial Analysis Intelligence Index</th><th>Analysis</th></tr></thead>
    <tbody>${rows.map(([name, lab, value, slug]) => `<tr><td>${name}</td><td>1M</td><td>${lab}</td><td>${value}</td><td><a href="/models/${slug}">Model</a></td></tr>`).join('')}</tbody></table>
    <script type="application/ld+json">${JSON.stringify({ mainEntity: [{ name: 'Which AI model ranks #1 on the LLM Leaderboard?', acceptedAnswer: {
      text: `Claude Opus 5.5 (max) currently ranks #1 on the Artificial Analysis LLM Leaderboard with an Intelligence Index score of ${score}, out of ${count} models ranked.` } }] })}</script>`;
}

test('Rotten Tomatoes selects All Critics, verifies identity, and distinguishes no-score from a failed page', () => {
  assert.equal(parseRottenTomatoes(rtPage()).score, 45);
  assert.equal(parseRottenTomatoes(rtPage('0')).score, 0);
  assert.equal(parseRottenTomatoes(rtPage(null)).state, 'no-score');
  assert.throws(() => parseRottenTomatoes('<html>captcha</html>'), /identity/);
  assert.throws(() => parseRottenTomatoes(rtPage().replace('Kitao Sakurai', 'Other Director')), /director/);
  assert.throws(() => parseRottenTomatoes(rtPage().replace('>45%<', '>46%<')), /conflicting/);
  assert.throws(() => parseRottenTomatoes(rtPage('101')), /conflicting/);
  assert.throws(() => parseRottenTomatoes(rtPage().replace('slot="critics-score"', 'slot="missing"')), /panel/);
});

test('AA uses visible ranking for tied scores and preserves methodology version', () => {
  const result = parseArtificialAnalysis(aaPage(), methodology);
  assert.equal(result.leader.creator, 'Anthropic');
  assert.equal(result.rows[1].score, result.leader.score);
  assert.equal(result.indexVersion, '4.3.2');
  assert.throws(() => parseArtificialAnalysis(aaPage({ second: 59 }), methodology), /not_ordered/);
  assert.throws(() => parseArtificialAnalysis(aaPage({ count: 3 }), methodology), /coverage/);
  assert.throws(() => parseArtificialAnalysis(aaPage().replace('value=""', 'value="OpenAI"'), methodology), /filters/);
  assert.throws(() => parseArtificialAnalysis(aaPage(), '<main>No index version</main>'), /version/);
  assert.throws(() => parseArtificialAnalysis(aaPage().replace('GPT-6 Astra', 'Other').replace('/models/gpt-6-astra', '/models/opus-max'), methodology), /duplicate/);
});

const models = value => `<main><h1>Models</h1>${value}</main>`;
const notes = value => `<main><h1>ChatGPT Release Notes</h1>${value}</main>`;
const announcement = text => ({ title: 'Introducing GPT-6.1 Astra', text, paragraphs: [text], url: 'https://openai.com/index/astra', published: Date.parse('2026-10-30T12:00:00Z') });
test('Astra is family/version-specific and requires official announcement plus public access', () => {
  assert.equal(qualifyingAstraNames('GPT-6.1 Sol and GPT-6 Astra').length, 0);
  assert.equal(qualifyingAstraNames('GPT-6.1 Astra and GPT Astra 7.0').length, 2);
  const yes = [announcement('GPT-6.1 Astra is now available in the API to all developers.')];
  assert.equal(parseAstraEvidence(yes, models('GPT-6.1 Astra'), notes('October')).state, 'yes');
  for (const text of ['GPT-6.1 Astra is not available in the API today.', 'GPT-6.1 Astra is now available in the API to selected users.',
    'GPT-6.1 Astra is now available in a private API preview.', 'GPT-6.1 Astra will be available in the API next month.']) {
    assert.throws(() => parseAstraEvidence([announcement(text)], models('GPT-6.1 Astra'), notes('October')), /ambiguous/);
  }
  assert.throws(() => parseAstraEvidence(yes, models('GPT-6 Sol'), notes('No new release')), /ambiguous/);
  assert.throws(() => parseAstraEvidence(yes, models('GPT-7.0 Astra'), notes('No new release')), /ambiguous/);
  assert.equal(parseAstraEvidence([], models('GPT-6 Astra and GPT-6.1 Sol'), notes('No new release')).state, 'no');
});

test('Astra scans a complete official dated feed, never treating a truncated or off-domain feed as No', () => {
  const item = (date, url) => `<item><title>Article</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const old = item('2020-01-01', 'https://openai.com/index/old');
  const current = item('2026-10-20', 'https://openai.com/index/new/story');
  assert.equal(parseOpenAiFeed(`<rss>${old}${current}</rss>`, '2026-10-01', '2026-11-01').length, 1);
  assert.throws(() => parseOpenAiFeed(`<rss>${current}</rss>`, '2026-10-01', '2026-11-01'), /incomplete/);
  assert.throws(() => parseOpenAiFeed(`<rss>${old}${current.replace('openai.com/index/new', 'evil.test/index/new')}</rss>`, '2026-10-01', '2026-11-01'), /incomplete/);
});

test('collector timestamps completed fetches, privately archives original evidence, and rejects redirects', async () => {
  let ticks = 0;
  const cfg = automaticConfig('rotten-tomatoes-cutoff', { cutoff: '2026-10-19T14:00:00Z' });
  const result = await collectCutoffEvidence(cfg, { fetchImpl: async () => new Response(rtPage()),
    clock: () => new Date(`2026-10-19T13:59:${ticks++ ? '20' : '10'}Z`) });
  assert.equal(result.payload.capturedAt, '2026-10-19T13:59:20.000Z');
  assert.equal(gunzipSync(Buffer.from(result.archive[0].bodyGzipBase64, 'base64')).toString(), rtPage());
  assert.equal(result.payload.documents[0].bodyGzipBase64, undefined);
  await assert.rejects(collectCutoffEvidence(cfg, { fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://evil.test' } }) }), /untrusted/);
  await assert.rejects(collectCutoffEvidence({ ...cfg, criteria: 'Use the audience score instead' }, { fetchImpl: () => assert.fail('fetch for modified contract') }), /modified/);
});

test('Astra collector checks the complete official bundle; a blocked announcement never becomes No', async () => {
  const item = (date, name, path) => `<item><title>${name}</title><link>https://openai.com/index/${path}</link><pubDate>${date}</pubDate></item>`;
  const rss = `<rss>${item('2020-01-01', 'Old', 'old')}${item('2026-10-20', 'OpenAI update', 'update')}</rss>`;
  const cfg = automaticConfig('openai-astra-release', { cutoff: '2026-11-01T05:59:59Z', openedAt: '2026-10-01T12:00:00Z' });
  const clock = () => new Date('2026-11-01T05:59:30Z');
  const fetchImpl = async url => new Response(url.endsWith('/rss.xml') ? rss : url.includes('developers.openai.com') ? models('GPT-6 Astra')
    : url.includes('help.openai.com') ? notes('<h2>September 1, 2026</h2>No launch update') : '<article><p>General company news.</p></article>');
  const result = await collectCutoffEvidence(cfg, { fetchImpl, clock });
  assert.equal(result.payload.state, 'no');
  assert.equal(result.payload.checkedAnnouncements.length, 1);
  assert.equal(result.archive.length, 4);
  await assert.rejects(collectCutoffEvidence(cfg, { fetchImpl: url => url.includes('/index/update')
    ? new Response('Forbidden', { status: 403 }) : fetchImpl(url), clock }), e => e.manualReview && /403/.test(e.message));
  assert.throws(() => parseAstraEvidence([], models('GPT-6 Astra'), notes('<h2>October 25, 2026</h2>No launch'), { openedAt: cfg.openedAt }), /incomplete_release_notes/);
});

const cutoff = '2026-10-19T14:00:00Z';
async function resolveStored(kind, payload, outcomes = RT_OUTCOMES, override = {}) {
  const cfg = automaticConfig(kind, { cutoff: kind === 'artificial-analysis-cutoff' ? '2026-10-20T05:59:59Z' : cutoff });
  const sql = { query: async (_q, params) => { assert.equal(params[1], contractHash(cfg, outcomes));
    return { rows: [{ payload, started_at: payload?.startedAt, captured_at: payload?.capturedAt }] }; } };
  return readCutoffResult(cfg, outcomes, { sql, marketId: 1, now: new Date('2026-11-02'), ...override });
}
const times = { startedAt: '2026-10-19T13:59:10Z', capturedAt: '2026-10-19T13:59:20Z' };
test('stored cutoff resolver ignores live pages, maps boundaries and cancels only a validated no-score capture', async () => {
  for (const [score, idx] of [[0, 0], [45, 0], [46, 1], [50, 1], [51, 2], [90, 9], [91, 10], [100, 10]]) {
    assert.equal((await resolveStored('rotten-tomatoes-cutoff', { state: 'scored', score, ...times })).winningIdx, idx);
  }
  assert.equal((await resolveStored('rotten-tomatoes-cutoff', { state: 'no-score', ...times })).cancel, true);
  const ai = { state: 'ranked', leader: { creator: 'New Lab' }, indexVersion: '4.3.2',
    startedAt: '2026-10-20T05:59:00Z', capturedAt: '2026-10-20T05:59:10Z' };
  assert.equal((await resolveStored('artificial-analysis-cutoff', ai, AA_OUTCOMES)).winningIdx, 5);
  ai.leader.creator = 'Anthropic';
  assert.equal((await resolveStored('artificial-analysis-cutoff', ai, AA_OUTCOMES)).winningIdx, 2);
});

test('stale, post-deadline, reversed, missing and mismatched evidence never pays', async () => {
  for (const time of [{ startedAt: '2026-10-19T13:58:59Z' }, { capturedAt: '2026-10-19T14:00:01Z' },
    { capturedAt: '2026-10-19T13:59:01Z' }, { capturedAt: 'invalid' }]) {
    await assert.rejects(resolveStored('rotten-tomatoes-cutoff', { state: 'scored', score: 45, ...times, ...time }), e => e.manualReview);
  }
  await assert.rejects(resolveStored('rotten-tomatoes-cutoff', { state: 'scored', score: 45, ...times }, ['wrong']), /outcomes/);
  await assert.rejects(resolveStored('rotten-tomatoes-cutoff', null), /missing/);
  await assert.rejects(resolveStored('rotten-tomatoes-cutoff', { state: 'scored', score: 45, ...times }, RT_OUTCOMES, { now: new Date('2026-10-18') }), /not_due/);
  await assert.rejects(resolveStored('rotten-tomatoes-cutoff', { state: 'scored', score: 45, ...times }, RT_OUTCOMES, {
    sql: { query: async () => [{ payload: { state: 'scored', score: 45, ...times }, started_at: times.startedAt, captured_at: '2026-10-19T14:00:01Z' }] },
  }), /stale/);
  const cfg = automaticConfig('rotten-tomatoes-cutoff', { cutoff });
  await assert.rejects(readCutoffResult({ ...cfg, criteriaEn: 'Different rules' }, RT_OUTCOMES,
    { sql: { query: () => assert.fail('lookup for modified contract') }, marketId: 1, now: new Date('2026-10-20') }), /modified/);
  await assert.rejects(readCutoffResult({ ...cfg, cutoff: '2026-10-19T14:30:00Z' }, RT_OUTCOMES,
    { sql: { query: () => assert.fail('lookup at an unpublished cutoff hour') }, marketId: 1, now: new Date('2026-10-20') }), /modified/);
});
