import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildWinnerPhoneRequestEmail,
  buildWinnerPhoneRequestEmailDrafts,
} from './winner-phone-email.js';

const source = await readFile(new URL('./winner-phone-email.js', import.meta.url), 'utf8');

test('winner phone email copy asks winners to add their phone in Perfil', () => {
  const draft = buildWinnerPhoneRequestEmail({
    username: 'campeon',
    rank: 2,
    profileUrl: 'https://pronos.io/earn',
  });

  assert.equal(draft.subject, 'Pronos: necesitamos tu teléfono para coordinar tu premio');
  assert.match(draft.text, /Hola @campeon/);
  assert.match(draft.text, /2° lugar/);
  assert.match(draft.text, /Añade tu teléfono/);
  assert.match(draft.text, /https:\/\/pronos\.io\/earn/);
  assert.match(draft.html, /Añade tu teléfono/);
});

test('winner phone email drafts are limited to the top five, use stats contacts, and do not send', () => {
  const winners = Array.from({ length: 6 }, (_, index) => ({
    rank: index + 1,
    username: `winner_${index + 1}`,
  }));
  const userSignups = winners.map((winner, index) => ({
    username: winner.username,
    email: `winner${index + 1}@example.com`,
    phoneNumber: index === 0 ? '+52 55 0000 0000' : null,
  }));

  const drafts = buildWinnerPhoneRequestEmailDrafts(winners, { userSignups });
  assert.equal(drafts.length, 5);
  assert.equal(drafts[0].to, 'winner1@example.com');
  assert.equal(drafts[0].phoneNumber, '+52 55 0000 0000');
  assert.equal(drafts[4].username, 'winner_5');
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /RESEND_API_KEY/);
  assert.doesNotMatch(source, /sendPointsWelcomeEmail/);
});
