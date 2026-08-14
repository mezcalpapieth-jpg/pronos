import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fundingSource = await readFile(new URL('./FundingPage.jsx', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('./Admin.jsx', import.meta.url), 'utf8');
const countsSource = await readFile(new URL('../lib/mvpAdminTaskCounts.js', import.meta.url), 'utf8');

test('funding page exposes deposit methods, history, and withdrawal request shell', () => {
  assert.match(fundingSource, /depositMethods/);
  assert.match(fundingSource, /SPEI/);
  assert.match(fundingSource, /Tarjeta/);
  assert.match(fundingSource, /Apple Pay/);
  assert.match(fundingSource, /history/);
  assert.match(fundingSource, /\/api\/protocol\/onboarding\/withdrawal-request/);
  assert.match(fundingSource, /destinationClabe/);
});

test('admin exposes funding monitor tab and task badge source', () => {
  assert.match(adminSource, /id:\s*'funding'/);
  assert.match(adminSource, /label:\s*'Fondeo'/);
  assert.match(adminSource, /FundingMonitorSection/);
  assert.match(adminSource, /\/api\/protocol\/admin\/funding-monitor/);
  assert.match(countsSource, /funding-monitor/);
  assert.match(countsSource, /funding:/);
});
