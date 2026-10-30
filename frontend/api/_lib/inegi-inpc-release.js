import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { formatMexicoDateYmd } from './market-gen/mexico-time.js';

const API = 'https://www.inegi.org.mx/app/api/saladeprensa/api/saladeprensa/';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const INPC_FIRST_RELEASE_CRITERIA = 'Se resuelve con el comunicado quincenal oficial del INPC publicado por INEGI para la primera quincena de octubre de 2026. Gana el rango que contenga la inflación anual reportada para esa quincena. Solo cuenta el dato inicial del comunicado oficial; revisiones posteriores no cuentan. Si el dato cae exactamente en un límite, gana el bucket superior.';
export const INPC_RELEASE_OUTCOMES = ['Menos de 3.00%', '3.00% a 3.49%', '3.50% a 3.99%', '4.00% o más'];

function text(value) {
  return parseHTML(`<main>${String(value || '')}</main>`).document.querySelector('main').textContent
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function deferred(reason, manualReview = false) {
  const error = new Error(reason);
  error.benign = true;
  error.manualReview = manualReview;
  error.info = { source: 'inegi-inpc-initial-release', reason,
    rationale: 'No se pudo confirmar de forma inequívoca el dato inicial del comunicado quincenal de INEGI. No usar una serie revisada para pagar este mercado.' };
  return error;
}

function periodParts(targetPeriod) {
  const match = String(targetPeriod || '').match(/^(20\d{2})-(0[1-9]|1[0-2])-1Q$/);
  if (!match) throw new Error('inegi_release_invalid_period');
  return { year: Number(match[1]), month: Number(match[2]), prefix: `${match[1]}-${match[2]}`,
    label: `primera quincena de ${MONTHS[Number(match[2]) - 1]} de ${match[1]}` };
}

export async function queryNews(method, params, fetchImpl) {
  // These POST endpoints are the public site's read-only news queries, not mutations.
  const response = await fetchImpl(`${API}${method}/v3`, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  if (!response.ok) throw deferred(`inegi_release_http_${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 2_000_000) throw new Error('inegi_release_document_too_large');
  const rows = JSON.parse(body);
  if (!Array.isArray(rows) || rows.length >= 50) throw deferred('inegi_release_listing_ambiguous', true);
  return rows;
}

export function parseInitialInpcRelease(row, targetPeriod, now = new Date()) {
  const period = periodParts(targetPeriod);
  if (!/indice nacional de precios al consumidor \(inpc\)/.test(text(row.programa)) || text(row.periodoInformacion) !== period.label) {
    throw deferred('inegi_release_period_mismatch', true);
  }
  const published = String(row.fechaInformacion || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const date = published ? `${published[3]}-${published[2]}-${published[1]}` : null;
  const expectedDateText = published ? `${Number(published[1])} de ${MONTHS[Number(published[2]) - 1]} de ${published[3]}` : null;
  if (!date || !date.startsWith(period.prefix) || Number(published[1]) < 16 || Number(published[1]) > 31
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    || text(row.fechaPublicacion) !== expectedDateText || date > formatMexicoDateYmd(now)) {
    throw deferred('inegi_release_publication_mismatch', true);
  }
  if (/revisad|corregid|fe de erratas|correccion|rectificad/.test(text(`${row.estatusInformacion} ${row.titulo} ${row.resumenNoticia}`))) {
    throw deferred('inegi_release_revision_not_allowed', true);
  }
  const month = String(period.month).padStart(2, '0');
  const pdfPath = `/saladeprensa/boletines/${period.year}/inpc/inpc_1q${period.year}_${month}.pdf`;
  if (row.urlPdf !== pdfPath) throw deferred('inegi_release_bulletin_mismatch', true);
  const headline = text(row.titulo);
  const match = headline.match(new RegExp(`^la inflacion anual fue de ([+-]?\\d+(?:[.,]\\d+)?)\\s*% en la ${period.label}$`));
  const annualRate = match ? Number(match[1].replace(',', '.')) : NaN;
  const { document } = parseHTML(`<main>${row.resumenNoticia || ''}</main>`);
  const paragraph = [...document.querySelectorAll('p')].map(node => text(node.textContent))
    .filter(value => value.startsWith(`en la ${period.label},`));
  const rates = paragraph.flatMap(value => [...value.matchAll(/(?:con este resultado, )?la inflacion general anual se ubico en ([+-]?\d+(?:[.,]\d+)?) (?:por ciento|%)/g)]
    .map(item => Number(item[1].replace(',', '.'))));
  if (!Number.isFinite(annualRate) || rates.length !== 1 || rates[0] !== annualRate) {
    throw deferred('inegi_release_annual_rate_ambiguous', true);
  }
  return { annualRate, targetPeriod, publicationDate: date,
    bulletinUrl: `https://www.inegi.org.mx/contenidos${pdfPath}`,
    officialHeadline: row.titulo,
    releaseHash: createHash('sha256').update(JSON.stringify(row)).digest('hex') };
}

export async function readInitialInpcRelease(cfg, outcomes, { fetchImpl = fetch, now = new Date() } = {}) {
  const readyAt = new Date(cfg.resolveAt);
  if (!Number.isFinite(readyAt.getTime()) || now < readyAt) throw deferred('inegi_release_not_due');
  if (JSON.stringify(outcomes) !== JSON.stringify(INPC_RELEASE_OUTCOMES)) throw new Error('inegi_release_outcome_mismatch');
  const period = periodParts(cfg.targetPeriod);
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const rows = await queryNews('ObtenerNoticiasTabla', {
    fechaDesde: `${period.prefix}-01`, fechaHasta: `${period.prefix}-${lastDay}`, ambito: '-1', token: 'INPC',
    tipoNoticia: '1,2,3,4,5,6,7,8', ordenarPor: 'publicacion', ordenAsc: '1', desde: '0', tomar: '50', ingles: '0',
    idPrograma: '-1', idTematica: '-1',
  }, fetchImpl);
  const candidates = rows.filter(row => text(row.periodo) === period.label && /indice nacional de precios al consumidor \(inpc\)/.test(text(row.titulo)));
  if (!candidates.length) throw deferred('inegi_initial_release_not_published', now - new Date(cfg.resolveAt) > 3 * 86400000);
  if (candidates.length !== 1 || !/^\d+$/.test(String(candidates[0].idNoticia))) throw deferred('inegi_release_listing_ambiguous', true);
  const id = String(candidates[0].idNoticia);
  const details = await queryNews('ObtenerInfoNoticia', { acronimo: '0', idNoticia: id, ingles: '0' }, fetchImpl);
  if (details.length !== 1) throw deferred('inegi_release_detail_ambiguous', true);
  const result = parseInitialInpcRelease(details[0], cfg.targetPeriod, now);
  if (candidates[0].fecha !== details[0].fechaInformacion || text(candidates[0].subtitulo) !== text(result.officialHeadline)) {
    throw deferred('inegi_release_listing_detail_conflict', true);
  }
  const value = result.annualRate;
  const winningIdx = value < 3 ? 0 : value < 3.5 ? 1 : value < 4 ? 2 : 3;
  return { winningIdx, resolverInfo: { source: 'inegi-inpc-initial-release', ...result,
    finalScore: `${value.toFixed(2)}% anual · ${period.label}`,
    evidenceUrl: `https://www.inegi.org.mx/app/saladeprensa/noticia/${id}` } };
}
