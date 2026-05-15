import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countryLabelFromFlag,
  deriveOutcomeCountryLabels,
} from './outcome-country-labels.js';

test('translates LATAM fighter flags into Spanish country labels', () => {
  assert.equal(countryLabelFromFlag('Ecuador'), 'Ecuador');
  assert.equal(countryLabelFromFlag('Mexico'), 'México');
  assert.equal(countryLabelFromFlag('Brazil'), 'Brasil');
  assert.equal(countryLabelFromFlag('United States'), null);
});

test('derives outcome country labels from UFC source fighter metadata by name', () => {
  const labels = deriveOutcomeCountryLabels({
    outcomes: ['Marlon Vera', "Sean O'Malley"],
    source_data: {
      fighters: [
        { id: '1', name: "Sean O'Malley", flag: 'United States' },
        { id: '2', name: 'Marlon Vera', flag: 'Ecuador' },
      ],
    },
  });

  assert.deepEqual(labels, ['Ecuador', null]);
});

test('keeps labels aligned by index when fighter names are missing', () => {
  const labels = deriveOutcomeCountryLabels({
    outcomes: ['Fighter A', 'Fighter B'],
    source_data: {
      fighters: [
        { id: '1', flag: 'Mexico' },
        { id: '2', flag: 'Argentina' },
      ],
    },
  });

  assert.deepEqual(labels, ['México', 'Argentina']);
});

test('returns null when no reliable regional country labels exist', () => {
  const labels = deriveOutcomeCountryLabels({
    outcomes: ['Fighter A', 'Fighter B'],
    source_data: {
      fighters: [
        { name: 'Fighter A', flag: 'United States' },
        { name: 'Fighter B', flag: 'Canada' },
      ],
    },
  });

  assert.equal(labels, null);
});
