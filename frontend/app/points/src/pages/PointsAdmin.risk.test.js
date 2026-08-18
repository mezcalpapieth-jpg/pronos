import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('Points admin exposes a risk review tab', () => {
  assert.match(source, /adminListRisk/);
  assert.match(source, /adminUpdateRiskReview/);
  assert.match(source, /return \['create', 'markets', 'stats', 'pending', 'social', 'support', 'deck', 'cycles', 'risk'\]/);
  assert.match(source, /\{ id: 'risk',\s+label: 'Riesgo' \}/);
  assert.match(source, /\{tab === 'risk' && <RiskPanel \/>\}/);
  assert.match(source, /function RiskPanel\(\)/);
  assert.match(apiSource, /export async function adminListRisk/);
  assert.match(apiSource, /\/api\/points\/admin\/risk/);
  assert.match(apiSource, /export async function adminUpdateRiskReview/);
});

test('Risk panel lets admins filter evidence and set non-payout review states', () => {
  assert.match(source, /Cuentas en revisión/);
  assert.match(source, /Loops rápidos/);
  assert.match(source, /Señales compartidas/);
  assert.match(source, /Cruces en el mismo mercado/);
  assert.match(source, /Flags manuales/);
  assert.match(source, /Cómo se arma el score/);
  assert.match(source, /Desglose del score/);
  assert.match(source, /Teléfono requerido/);
  assert.match(source, /verificación telefónica/);
  assert.match(source, /function RiskScoreBreakdown/);
  assert.match(source, /function riskScoreBreakdown/);
  assert.match(source, /expandedLoopUser/);
  assert.match(source, /expandedSignalUser/);
  assert.match(source, /function RiskInlineEvidence/);
  assert.match(source, /function RiskLoopEvidenceRow/);
  assert.match(source, /function RiskTradeSequence/);
  assert.match(source, /function RiskSignalEvidenceRow/);
  assert.match(source, /loopCount \* 30/);
  assert.match(source, /sharedSignalCount \* 20/);
  assert.match(source, /linkedUsernames/);
  assert.match(source, /Ver'\} · \{adminNumber\(trades\.length \|\| row\.tradeCount\)\} trades/);
  assert.match(source, /riskStatusLabel/);
  assert.match(source, /phone_required/);
  assert.match(source, /under_review/);
  assert.match(source, /ineligible/);
  assert.match(source, /no mueve balances, no borra posiciones/);
  assert.match(source, /setReviewDrafts/);
  assert.match(source, /adminUpdateRiskReview\(\{\s*username,\s*status,\s*reason/);
});

test('Risk panel labels hashed signals without revealing raw IPs or device IDs', () => {
  assert.match(source, /riskSignalLabel/);
  assert.match(source, /signalKey/);
  assert.match(source, /ip: 'IP'/);
  assert.match(source, /Dispositivo/);
  assert.match(source, /Sesión/);
  assert.doesNotMatch(source, /ipAddress/);
  assert.doesNotMatch(source, /userAgent/);
});
