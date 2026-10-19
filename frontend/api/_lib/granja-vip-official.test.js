import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertGranjaVipFinalNominees,
  buildGranjaVipWeeklyMarketSpec,
  extractParticipantsFromOfficialHtml,
  nextGranjaVipSundayClose,
  nextGranjaVipCapatazClose,
  parseOfficialGranjaArticle,
  readGranjaVipOfficialResult,
  readGranjaVipOfficialSnapshot,
} from './granja-vip-official.js';

const OFFICIAL_SECTION_HTML = `
  <main>
    <h3>Granjeros: La Granja VIP Segunda Temporada</h3>
    <a href="/aztecauno/la-granja-vip/carlos-trejo">Carlos Trejo</a>
    <a href="/aztecauno/la-granja-vip/ivonne-montero">Ivonne Montero</a>
    <a href="/aztecauno/la-granja-vip/kunno">Kunno</a>
    <a href="/aztecauno/la-granja-vip/mono-osuna">Mono Osuna</a>
    <a href="/aztecauno/la-granja-vip/pascal-nadaud">Pascal Nadaud</a>
    <a href="/aztecauno/la-granja-vip/pimpinela-escarlata">Pimpinela Escarlata</a>
    <h3>Conductores | La Granja VIP Segunda Temporada | Críticos</h3>
    <a href="/aztecauno/la-granja-vip/adal-ramones">Adal Ramones</a>
  </main>
`;

test('extractParticipantsFromOfficialHtml reads the official granjeros section only', () => {
  const rows = extractParticipantsFromOfficialHtml(OFFICIAL_SECTION_HTML, {
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
  });

  assert.deepEqual(rows.map(row => row.name), [
    'Carlos Trejo',
    'Ivonne Montero',
    'Kunno',
    'Mono Osuna',
    'Pascal Nadaud',
    'Pimpinela Escarlata',
  ]);
  assert.ok(rows.every(row => row.url.startsWith('https://www.tvazteca.com/')));
});

const BASE = 'https://www.tvazteca.com/aztecauno/la-granja-vip/';

function article(title, publishedAt, body) {
  return `<meta property="article:published_time" content="${publishedAt}"><article><h1>${title}</h1><div class="articleBody">${body}</div></article>`;
}

function fixtureFetch(articles, extra = '') {
  const listing = OFFICIAL_SECTION_HTML + extra + articles.map(item => `<a href="${item.path}">${item.title}</a>`).join('');
  return async input => {
    const url = new URL(input);
    const found = articles.find(item => url.pathname === new URL(item.path, BASE).pathname);
    return { ok: true, status: 200, text: async () => found ? article(found.title, found.publishedAt, found.body) : listing };
  };
}

test('dated article parsing excludes Corral VIP and requires publication metadata', () => {
  assert.equal(parseOfficialGranjaArticle(article('El Corral VIP: nominados', '2026-10-14T21:00:00Z', '<p>Lista</p>'), BASE), null);
  assert.equal(parseOfficialGranjaArticle('<article><h1>Lista de nominados</h1></article>', BASE), null);
  assert.equal(parseOfficialGranjaArticle(article('Lista de nominados', '2026-10-14T21:00:00', '<p>Lista</p>'), BASE).publishedAt, '2026-10-14T21:00:00.000Z');
});

test('stale and unrelated nominees never generate the next weeks elimination', async () => {
  const fetchImpl = fixtureFetch([
    { path: 'nominados-pasados/', title: 'OFICIAL: Lista de nominados', publishedAt: '2026-10-08T23:00:00Z', body: '<p>Actualmente los nominados son: Carlos Trejo, Kunno e Ivonne Montero.</p>' },
    { path: 'corral-nominados/', title: 'El Corral VIP: nominados', publishedAt: '2026-10-14T23:00:00Z', body: '<p>Actualmente los nominados son: Carlos Trejo, Kunno e Ivonne Montero.</p>' },
  ]);
  const now = new Date('2026-10-15T18:00:00Z');
  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now });
  assert.deepEqual(snapshot.nominated, []);
  assert.equal(buildGranjaVipWeeklyMarketSpec({ snapshot, now }), null);
});

test('capataz generates only with the dated finalists for the upcoming Monday', async () => {
  const fetchImpl = fixtureFetch([{ path: 'finalistas-capataz/', title: 'Finalistas que lucharán por ser Capataz', publishedAt: '2026-10-12T21:45:00Z',
    body: '<p>La final reunirá a Bebeshita, Pablo Montero, Julio Camejo e Ivonne Montero.</p>' }]);
  const now = new Date('2026-10-12T22:00:00Z');
  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now });
  const spec = buildGranjaVipWeeklyMarketSpec({ snapshot, now, kind: 'capataz' });
  assert.equal(spec.source_event_id, 'granja-vip-capataz:2026-10-12');
  assert.equal(spec.end_time, '2026-10-13T02:25:00.000Z');
  assert.equal(spec.resolver_config.kind, 'granja-vip-capataz');
  assert.deepEqual(new Set(spec.outcomes), new Set(['Daniela Alexis "Bebeshita"', 'Pablo Montero', 'Julio Camejo', 'Ivonne Montero']));
  const later = new Date('2026-10-15T18:00:00Z');
  const stale = await readGranjaVipOfficialSnapshot({ fetchImpl, now: later });
  assert.equal(buildGranjaVipWeeklyMarketSpec({ snapshot: stale, now: later, kind: 'capataz' }), null);
  assert.equal(nextGranjaVipCapatazClose(new Date('2026-10-13T02:25:00Z')).toISOString(), '2026-10-20T02:25:00.000Z');
});

test('official elimination can resolve even after todays roster marks the winner eliminated', async () => {
  const nominees = { path: 'nominados-actuales/', title: 'Lista FINAL de nominados', publishedAt: '2026-10-17T04:00:00Z', body: '<p>Actualmente los nominados son: Carlos Trejo e Ivonne Montero.</p>' };
  const result = { path: 'eliminado-gala/', title: 'Carlos Trejo es el eliminado de La Granja VIP', publishedAt: '2026-10-19T04:00:00Z', body: '<p>Carlos Trejo fue eliminado en la gala del domingo 18 de octubre.</p>' };
  const fetchImpl = fixtureFetch([nominees, result], '<h3>Eliminados: La Granja VIP Segunda Temporada</h3><p>Carlos Trejo</p><h3>Conductores</h3>');
  const cfg = { kind: 'granja-vip-elimination', weekKey: '2026-10-18', resolveAt: '2026-10-19T01:55:00Z' };
  const options = { fetchImpl, now: new Date('2026-10-19T05:00:00Z') };
  assert.equal((await readGranjaVipOfficialResult(cfg, ['Carlos Trejo', 'Ivonne Montero'], options)).winningIdx, 0);
  await assert.rejects(() => readGranjaVipOfficialResult(cfg, ['Kunno', 'Ivonne Montero'], options), error => error.benign && error.manualReview);
});

test('official capataz uses that contests result, not old titles or speculative headlines', async () => {
  const finalists = { path: 'finalistas-capataz/', title: 'Finalistas que lucharán por ser Capataz', publishedAt: '2026-10-12T21:45:00Z',
    body: '<p>La final reunirá a Pablo Montero, Julio Camejo e Ivonne Montero.</p>' };
  const result = { path: 'pablo-gana-capataz/', title: 'Pablo Montero se convierte en el nuevo Capataz', publishedAt: '2026-10-13T04:00:00Z', body: '<p>Pablo Montero ganó la prueba de Capataz.</p>' };
  const cfg = { kind: 'granja-vip-capataz', weekKey: '2026-10-12', resolveAt: '2026-10-13T02:25:00Z' };
  const now = new Date('2026-10-13T05:00:00Z');
  const outcomes = ['Ivonne Montero', 'Julio Camejo', 'Pablo Montero'];
  assert.equal((await readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists, result]), now })).winningIdx, 2);
  for (const invalid of [{ ...result, publishedAt: '2026-10-06T04:00:00Z' }, { ...result, title: '¿Pablo Montero será el nuevo Capataz?' }]) {
    await assert.rejects(() => readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists, invalid]), now }), /missing_or_ambiguous/);
  }
  const conflicting = { ...result, path: 'julio-gana-capataz/', title: 'Julio Camejo se convierte en el nuevo Capataz' };
  await assert.rejects(() => readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists, result, conflicting]), now }), error => error.benign && error.manualReview);
  await assert.rejects(() => readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists]), now: new Date('2026-10-15T05:00:00Z') }), error => error.benign && error.manualReview);
});

test('readGranjaVipOfficialSnapshot ignores undated nomination headlines', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      ${OFFICIAL_SECTION_HTML}
      <a href="/aztecauno/la-granja-vip/nominados">
        Carlos Trejo, Ivonne Montero y Kunno son los nominados de La Granja VIP
      </a>
    `,
  });

  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl,
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    now: new Date('2026-09-09T18:00:00Z'),
  });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.nominated, []);
  assert.equal(snapshot.eliminated.length, 0);
});

test('readGranjaVipOfficialSnapshot follows official nominee article links', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes('/nominados-finales/')
      ? `
        <meta property="article:published_time" content="2026-10-08T00:00:00Z">
        <article>
          <h1>OFICIAL: LISTA completa de NOMINADOS en la quinta semana</h1>
          <p>Aunque la Tabla final cambiará luego del viernes de Traición,
          actualmente los nominados son: Pimpinela Escarlata Ivonne Montero
          Julio Camejo Pascal Nadaud Natalia Alcocer</p>
          <p>Tags relacionados</p>
        </article>
      `
      : `
        ${OFFICIAL_SECTION_HTML.replace('<h3>Conductores', '<a href="/aztecauno/la-granja-vip/natalia-alcocer">Natalia Alcocer</a><a href="/aztecauno/la-granja-vip/julio-camejo">Julio Camejo</a><h3>Conductores')}
        <a href="/aztecauno/la-granja-vip/nominados-finales/">
          OFICIAL: LISTA completa de NOMINADOS en la quinta semana de La Granja VIP
        </a>
      `,
  });

  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl,
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    now: new Date('2026-10-08T18:00:00Z'),
  });

  assert.deepEqual(snapshot.nominated.map(row => row.name), [
    'Ivonne Montero',
    'Pascal Nadaud',
    'Pimpinela Escarlata',
    'Natalia Alcocer',
    'Julio Camejo',
  ]);
  assert.equal(snapshot.nomineeEvidence[0].url, 'https://www.tvazteca.com/aztecauno/la-granja-vip/nominados-finales/');
});

test('readGranjaVipOfficialSnapshot extracts final list after earlier nomination changes', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes('/tabla-nominados/')
      ? `
        <meta property="article:published_time" content="2026-10-08T00:00:00Z">
        <article>
          <h1>El huevo dorado cambió la Tabla de Nominados</h1>
          <p>Mónica Escobedo recibió votos, pero Mono Osuna la sacó de la tabla.</p>
          <p>Natalia Alcocer puso a Pascal Nadaud automáticamente.</p>
          <p>Así quedó la Tabla de Nominados este miércoles. Actualmente los nominados son:
          Pimpinela Escarlata Ivonne Montero Julio Camejo Pascal Nadaud Natalia Alcocer</p>
          <p>Tags relacionados Mónica Escobedo Mono Osuna</p>
        </article>
      `
      : `
        ${OFFICIAL_SECTION_HTML.replace('<h3>Conductores', '<a href="/aztecauno/la-granja-vip/natalia-alcocer">Natalia Alcocer</a><a href="/aztecauno/la-granja-vip/julio-camejo">Julio Camejo</a><h3>Conductores')}
        <a href="/aztecauno/la-granja-vip/tabla-nominados/">
          El huevo dorado benefició a dos Granjeros y cambió la Tabla de Nominados
        </a>
      `,
  });

  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl,
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    now: new Date('2026-10-08T18:00:00Z'),
  });

  assert.deepEqual(snapshot.nominated.map(row => row.name), [
    'Ivonne Montero',
    'Pascal Nadaud',
    'Pimpinela Escarlata',
    'Natalia Alcocer',
    'Julio Camejo',
  ]);
  assert.ok(!snapshot.nominated.some(row => row.name === 'Mónica Escobedo'));
  assert.ok(!snapshot.nominated.some(row => row.name === 'Mono Osuna'));
});

test('nextGranjaVipSundayClose defaults to before the Sunday elimination gala', () => {
  const close = nextGranjaVipSundayClose(new Date('2026-09-09T18:00:00Z'));
  assert.equal(close.toISOString(), '2026-09-14T01:55:00.000Z');
});

test('buildGranjaVipWeeklyMarketSpec creates an automatic elimination draft with dated final evidence', () => {
  const now = new Date('2026-09-12T18:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    observedAt: now.toISOString(),
    parsedCount: 3,
    total: 6,
    nominationFinal: true,
    nomineeEvidence: [{ title: 'Lista FINAL de nominados', url: 'https://www.tvazteca.com/aztecauno/la-granja-vip/nominados/', publishedAt: now.toISOString() }],
    rows: [
      { name: 'Carlos Trejo', slug: 'carlos-trejo', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/carlos' },
      { name: 'Ivonne Montero', slug: 'ivonne-montero', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/ivonne' },
      { name: 'Kunno', slug: 'kunno', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/kunno' },
    ],
    nominated: [
      { name: 'Carlos Trejo', slug: 'carlos-trejo', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/carlos' },
      { name: 'Ivonne Montero', slug: 'ivonne-montero', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/ivonne' },
      { name: 'Kunno', slug: 'kunno', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/kunno' },
    ],
  };

  const spec = buildGranjaVipWeeklyMarketSpec({ snapshot, now });

  assert.equal(spec.source, 'granja-vip-official');
  assert.equal(spec.source_event_id, 'granja-vip-elimination:2026-09-13');
  assert.equal(spec.resolver_type, 'api_chart');
  assert.equal(spec.amm_mode, 'parallel');
  assert.deepEqual(spec.outcomes, ['Carlos Trejo', 'Ivonne Montero', 'Kunno']);
  assert.equal(spec.resolver_config.source, 'official-result');
  assert.equal(spec.source_data.kind, 'granja_vip_week');
  assert.deepEqual(spec.geo_tags, ['mexico']);
  assert.deepEqual(spec.topic_tags, ['tv', 'farandula']);
});

const OCT_THURSDAY = {
  path: 'oficial-lista-actualizada-nominados-jueves-15-octubre-riesgo-eliminacion/',
  title: 'OFICIAL: Lista Actualizada de NOMINADOS hoy jueves 15 de octubre',
  publishedAt: '2026-10-16T04:39:20.628Z',
  body: `<p>Azalia Ojeda ganó el Juego de Salvación y salió de la tabla.</p>
    <p>Hoy, jueves 15 de octubre, se han dado a conocer la lista actualizada de nominados,
    conformado por Mario "Mono" Osuna, Julio Camejo y Kevyn "Bicolor" Contreras;
    quienes se encuentran en total riesgo de eliminación.</p>
    <aside><p>Actualmente los nominados son: Carlos Trejo e Ivonne Montero.</p></aside>`,
};
const OCT_FINAL = {
  path: 'oficial-lista-final-nominados-sexta-semana-ultima-oportunidad-para-no-ser-eliminados/',
  title: 'OFICIAL: Lista FINAL de nominados en la sexta semana de La Granja VIP',
  publishedAt: '2026-10-17T04:47:01.514Z',
  body: `<p>Hoy, 16 de octubre fue el viernes de Traición, una oportunidad que Azalia Ojeda ganó
    en el Juego de Salvación, en el que podía escoger a uno de los Granjeros para salvar.
    Al final de la velada, en la lista final de nominados se posicionaron Pimpinela Escarlata,
    Julio Camejo, Kevyn "Bicolor" Contreras, Niurka y Mónica Escobedo.</p>
    <aside><p>Mono Osuna y Carlos Trejo</p></aside>`,
};
const OCT_RESULT = {
  path: 'la-granja-vip-que-granjero-fue-el-sexto-eliminado-hoy-18-octubre-2026/',
  title: 'ÚLTIMA HORA: Pimpinela Escarlata es el sexto ELIMINADO de La Granja VIP Segunda Temporada hoy domingo 18 de octubre, tras ser vencido por Kevyn Contreras “Bicolor”, Niurka, y Julio Camejo',
  publishedAt: '2026-10-19T05:08:54.041Z', body:'<p>Pimpinela Escarlata fue eliminado.</p>',
};
const OCT_OUTCOMES = ['Pimpinela Escarlata','Julio Camejo','Kevyn Contreras "Bicolor"','Niurka Marcos','Mónica Escobedo'];
const OCT_CFG = {kind:'granja-vip-elimination',weekKey:'2026-10-18',resolveAt:'2026-10-19T01:55:00Z'};

test('Thursday updated wording is parsed but cannot generate before Friday final nominations', async () => {
  const now = new Date('2026-10-16T15:00:00Z');
  const snapshot = await readGranjaVipOfficialSnapshot({fetchImpl:fixtureFetch([OCT_THURSDAY]),now});
  assert.deepEqual(new Set(snapshot.nominated.map(row=>row.name)),new Set(['Mono Osuna','Julio Camejo','Kevyn Contreras "Bicolor"']));
  assert.equal(snapshot.nominationFinal,false);
  assert.equal(buildGranjaVipWeeklyMarketSpec({snapshot,now}),null);
});

test('Friday final list supersedes Thursday and ignores the savior and sidebar in the same article', async () => {
  const noise = Array.from({length:15},(_,i)=>({path:`nominado-video-${i}/`,title:`Entrevista con un nominado ${i}`,
    publishedAt:'2026-10-17T06:00:00Z',body:'<p>Conversación con Mono Osuna.</p>'}));
  const now = new Date('2026-10-17T16:00:00Z');
  const snapshot = await readGranjaVipOfficialSnapshot({fetchImpl:fixtureFetch([OCT_THURSDAY,...noise,OCT_FINAL]),now});
  assert.equal(snapshot.nominationFinal,true);
  assert.deepEqual(new Set(snapshot.nominated.map(row=>row.name)),new Set(OCT_OUTCOMES));
  assert.equal(snapshot.nomineeEvidence[0].url,new URL(OCT_FINAL.path,BASE).href);
  const spec = buildGranjaVipWeeklyMarketSpec({snapshot,now});
  assert.deepEqual(new Set(spec.outcomes),new Set(OCT_OUTCOMES));
  assert.equal(spec.source_event_id,'granja-vip-elimination:2026-10-18');
});

test('Thursday final claims, stale finals, and an unreadable newer final never authorize a draft', async () => {
  const now = new Date('2026-10-17T16:00:00Z');
  for (const articles of [
    [{...OCT_FINAL,publishedAt:'2026-10-16T04:00:00Z'}],
    [{...OCT_FINAL,publishedAt:'2026-10-10T04:47:00Z'}],
    [OCT_FINAL,{...OCT_FINAL,path:'nueva-lista-final-nominados/',publishedAt:'2026-10-17T06:00:00Z',body:'<p>Lista pendiente de confirmar.</p>'}],
  ]) {
    const snapshot=await readGranjaVipOfficialSnapshot({fetchImpl:fixtureFetch(articles),now});
    assert.equal(snapshot.nominationFinal,false);
    assert.equal(buildGranjaVipWeeklyMarketSpec({snapshot,now}),null);
  }
});

test('approval rechecks official Friday final nominees and rejects stale provisional options', async () => {
  const now=new Date('2026-10-17T16:00:00Z');
  const fetchImpl=fixtureFetch([OCT_THURSDAY,OCT_FINAL]);
  assert.equal((await assertGranjaVipFinalNominees(OCT_CFG,OCT_OUTCOMES,{fetchImpl,now})).nominationFinal,true);
  await assert.rejects(assertGranjaVipFinalNominees(OCT_CFG,['Mono Osuna','Julio Camejo','Kevyn Contreras "Bicolor"'],{fetchImpl,now}),
    {message:'granja_contestant_field_changed_or_unavailable',status:409});
  await assert.rejects(assertGranjaVipFinalNominees(OCT_CFG,OCT_OUTCOMES,{fetchImpl:fixtureFetch([OCT_THURSDAY]),now}),
    {message:'granja_final_nominees_unavailable',status:409});
  const renamed=OCT_OUTCOMES.map(name=>name.replace('Kevyn','Kevin'));
  assert.ok(await assertGranjaVipFinalNominees(OCT_CFG,renamed,{fetchImpl,now}));
  for (const cfg of [
    {...OCT_CFG,weekKey:'2026-10-11',resolveAt:'2026-10-12T01:55:00Z'},
    {...OCT_CFG,resolveAt:'2026-10-26T01:55:00Z'},
    {...OCT_CFG,resolveAt:'invalid'},
  ]) {
    await assert.rejects(assertGranjaVipFinalNominees(cfg,OCT_OUTCOMES,{fetchImpl,now}),
      {message:'granja_nomination_week_mismatch',status:409});
  }
  assert.equal(await assertGranjaVipFinalNominees({kind:'granja-vip-capataz'},[],{now}),null);
});

test('Sunday result identifies the eliminated subject even when survivors appear in the headline', async () => {
  const now=new Date('2026-10-19T06:00:00Z');
  const fetchImpl=fixtureFetch([OCT_THURSDAY,OCT_FINAL,OCT_RESULT]);
  const result=await readGranjaVipOfficialResult(OCT_CFG,OCT_OUTCOMES,{fetchImpl,now});
  assert.equal(result.winningIdx,0);
  assert.equal(result.resolverInfo.evidenceUrl,new URL(OCT_RESULT.path,BASE).href);
  await assert.rejects(readGranjaVipOfficialResult(OCT_CFG,['Mono Osuna','Julio Camejo','Kevyn Contreras "Bicolor"'],{fetchImpl,now}),
    error=>error.benign && error.manualReview && error.message==='granja_contestant_field_changed_or_unavailable');
});

test('missing final nominee evidence queues manual review immediately after close', async () => {
  await assert.rejects(readGranjaVipOfficialResult(OCT_CFG,OCT_OUTCOMES,{
    fetchImpl:fixtureFetch([OCT_RESULT]),now:new Date('2026-10-19T06:00:00Z'),
  }),error=>error.benign && error.manualReview && error.message==='granja_final_nominees_unavailable');
});

test('official monthly and news sitemaps discover the Friday lineup and Sunday result when listings omit them', async () => {
  const articles=[OCT_FINAL,OCT_RESULT];
  const urls=[];
  const fetchImpl=async input=>{
    const url=new URL(input);urls.push(url.href);
    let html=OFFICIAL_SECTION_HTML;
    if(url.pathname.endsWith('sitemap-202610.xml'))html=`<urlset><url><loc>${new URL(OCT_FINAL.path,BASE)}</loc><lastmod>2026-10-17T04:48:00Z</lastmod></url>
      <url><loc>https://attacker.example/aztecauno/la-granja-vip/fake-nominados/</loc></url></urlset>`;
    else if(url.pathname.endsWith('newslatest-sitemap-latest.xml'))html=`<urlset><url><loc>${new URL(OCT_RESULT.path,BASE)}</loc><lastmod>2026-10-19T05:09:00Z</lastmod></url></urlset>`;
    else {const found=articles.find(a=>url.pathname===new URL(a.path,BASE).pathname);if(found)html=article(found.title,found.publishedAt,found.body);}
    return {ok:true,status:200,text:async()=>html};
  };
  const result=await readGranjaVipOfficialResult(OCT_CFG,OCT_OUTCOMES,{fetchImpl,now:new Date('2026-10-19T06:00:00Z')});
  assert.equal(result.winningIdx,0);
  assert.ok(urls.some(u=>u.includes('sitemap-202610.xml')));
  assert.ok(urls.some(u=>u.includes('newslatest-sitemap-latest.xml')));
  assert.ok(urls.every(u=>new URL(u).hostname==='www.tvazteca.com'));
});

test('unknown names in the official final list are never silently omitted', async () => {
  const final={...OCT_FINAL,body:'<p>La lista final de nominados son Carlos Trejo, Kunno y Una Persona Nueva.</p>'};
  const now=new Date('2026-10-17T16:00:00Z');
  const snapshot=await readGranjaVipOfficialSnapshot({fetchImpl:fixtureFetch([final]),now});
  assert.equal(snapshot.nominationFinal,false);
  assert.deepEqual(snapshot.nominated,[]);
  assert.equal(buildGranjaVipWeeklyMarketSpec({snapshot,now}),null);
});
