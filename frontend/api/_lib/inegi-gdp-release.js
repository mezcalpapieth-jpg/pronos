import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from 'linkedom';
import { queryNews } from './inegi-inpc-release.js';
import { GDP_OUTCOMES } from './automated-market-rules.js';
import { formatMexicoDateYmd } from './market-gen/mexico-time.js';

const QUARTERS = ['primer', 'segundo', 'tercer', 'cuarto'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const words = node => [...node.getElementsByTagName('w:t')].map(n => n.textContent).join('');

function pending(reason, manualReview = false) {
  return Object.assign(new Error(reason), { benign: true, manualReview,
    info: { source: 'inegi-gdp-first-release', rationale: 'Solo se permite el PIB original real anual del primer boletín oportuno; no sustituir por cifras ajustadas ni revisiones.' } });
}

function periodParts(targetPeriod) {
  const match = String(targetPeriod).match(/^(20\d{2})-Q([1-4])$/);
  if (!match) throw new Error('gdp_invalid_period');
  const year = Number(match[1]); const quarter = Number(match[2]);
  const releaseYear = quarter === 4 ? year + 1 : year;
  const releaseMonth = (quarter * 3) % 12 + 1;
  const month = String(releaseMonth).padStart(2, '0');
  return { year, quarter, releaseYear, releaseMonth, prefix: `${releaseYear}-${month}`,
    label: `${QUARTERS[quarter - 1]} trimestre de ${year}` };
}

// Use Word's merged-cell grid, not the position of the last number (which may be year-to-date).
export function parseGdpBulletinXml(xml, targetPeriod) {
  const period = periodParts(targetPeriod);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw pending('gdp_bulletin_invalid', true);
  const nodes = [...body.children];
  const matches = [];
  for (let i = 0; i < nodes.length; i++) {
    const table = nodes[i];
    if (table.tagName !== 'w:tbl') continue;
    const heading = norm(nodes.slice(Math.max(0, i - 7), i).map(words).join(' '));
    if (!heading.includes('cuadro 2') || !heading.includes('cifras originales')
      || !heading.includes('variacion porcentual real anual') || !heading.includes(period.label)) continue;
    const grid = [...table.getElementsByTagName('w:tr')].map(tr => {
      const cells = [];
      for (const tc of tr.children) {
        if (tc.tagName !== 'w:tc') continue;
        const span = Number(tc.getElementsByTagName('w:gridSpan')[0]?.getAttribute('w:val') || 1);
        if (!Number.isInteger(span) || span < 1 || span > 16) throw pending('gdp_invalid_table_grid', true);
        for (let n = 0; n < span; n++) cells.push(norm(words(tc)));
      }
      return cells;
    });
    const yearRow = grid.findIndex(row => row.some(cell => cell === String(period.year)));
    if (yearRow < 0 || !grid[yearRow + 1]) continue;
    const columns = grid[yearRow].map((year, col) => {
      const quarter = grid[yearRow + 1][col]?.match(/^([1-4])\.(?:er|°)/);
      return year === String(period.year) && Number(quarter?.[1]) === period.quarter ? col : -1;
    }).filter(col => col >= 0);
    const rows = grid.filter(row => row[0] === 'pib');
    if (columns.length !== 1 || rows.length !== 1 || rows[0].length !== grid[yearRow].length) continue;
    const value = rows[0][columns[0]];
    if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(value)) continue;
    matches.push(Number(value.replace(',', '.')));
  }
  if (matches.length !== 1) throw pending('gdp_original_annual_table_ambiguous', true);
  return matches[0];
}

export async function readInitialGdpRelease(cfg, outcomes, { fetchImpl = fetch, now = new Date() } = {}) {
  if (JSON.stringify(outcomes) !== JSON.stringify(GDP_OUTCOMES)) throw new Error('gdp_outcomes_mismatch');
  const period = periodParts(cfg.targetPeriod);
  const today = formatMexicoDateYmd(now);
  const rows = await queryNews('ObtenerNoticiasTabla', {
    fechaDesde: `${period.prefix}-01`, fechaHasta: today, ambito: '-1', token: 'PIB',
    tipoNoticia: '1,2,3,4,5,6,7,8', ordenarPor: 'publicacion', ordenAsc: '1', desde: '0', tomar: '50', ingles: '0',
    idPrograma: '-1', idTematica: '-1',
  }, fetchImpl);
  const candidates = rows.filter(row => norm(row.periodo) === period.label && norm(row.titulo).startsWith('estimacion oportuna del pib trimestral'));
  if (!candidates.length) throw pending('gdp_initial_release_not_published');
  if (candidates.length !== 1 || !/^\d+$/.test(String(candidates[0].idNoticia))) throw pending('gdp_multiple_initial_releases', true);
  const id = String(candidates[0].idNoticia);
  const details = await queryNews('ObtenerInfoNoticia', { acronimo: '0', idNoticia: id, ingles: '0' }, fetchImpl);
  const row = details[0];
  const date = String(row?.fechaInformacion).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const ymd = date && `${date[3]}-${date[2]}-${date[1]}`;
  if (!ymd || ymd < `${period.prefix}-01` || ymd > today
    || !Number.isFinite(Date.parse(`${ymd}T12:00:00Z`)) || new Date(`${ymd}T12:00:00Z`).toISOString().slice(0, 10) !== ymd
    || norm(row.fechaPublicacion) !== `${Number(date[1])} de ${MONTHS[Number(date[2]) - 1]} de ${date[3]}`) {
    throw pending('gdp_publication_date_mismatch', true);
  }
  const path = `/saladeprensa/boletines/${date[3]}/pibo/pib_eo${date[3]}_${date[2]}`;
  if (details.length !== 1 || norm(row.periodoInformacion) !== period.label
    || !norm(row.programa).startsWith('estimacion oportuna del pib trimestral')
    || row.urlPdf !== `${path}.pdf` || row.urlDoc !== `${path}.docx`
    || candidates[0].fecha !== row.fechaInformacion || norm(candidates[0].subtitulo) !== norm(row.titulo)
    || /revisad|corregid|fe de erratas|correccion|rectificad/.test(norm(`${row.estatusInformacion} ${row.titulo} ${row.resumenNoticia}`))) {
    throw pending('gdp_release_identity_or_revision_mismatch', true);
  }
  const url = `https://www.inegi.org.mx/contenidos${row.urlDoc}`;
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw pending(`gdp_bulletin_http_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 2_000_000) throw pending('gdp_bulletin_too_large', true);
  let oversized = false;
  const zip = unzipSync(bytes, { filter: file => {
    if (file.name !== 'word/document.xml') return false;
    oversized = file.originalSize > 4_000_000;
    return !oversized;
  } });
  if (oversized || !zip['word/document.xml']) throw pending('gdp_bulletin_xml_missing_or_large', true);
  const annualRate = parseGdpBulletinXml(strFromU8(zip['word/document.xml']), cfg.targetPeriod);
  const winningIdx = [0.5, 1, 1.5, 2, 2.5, 3, 3.5].findIndex(bound => annualRate < bound);
  return { winningIdx: winningIdx < 0 ? 7 : winningIdx, resolverInfo: {
    source: 'inegi-gdp-first-release', targetPeriod: cfg.targetPeriod, annualRate, series: 'original', measure: 'real-yoy',
    publicationDate: ymd, releaseHash: createHash('sha256').update(bytes).digest('hex'),
    evidenceUrl: `https://www.inegi.org.mx/app/saladeprensa/noticia/${id}`, bulletinUrl: url,
  } };
}
