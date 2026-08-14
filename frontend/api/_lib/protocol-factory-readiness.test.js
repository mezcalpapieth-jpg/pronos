import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFactoryProbeStatus,
  appendFactoryProbeWarnings,
} from './protocol-factory-readiness.js';

const ADDR = {
  safe: '0x1111111111111111111111111111111111111111',
  creator: '0x2222222222222222222222222222222222222222',
  resolver: '0x3333333333333333333333333333333333333333',
  collateral: '0x4444444444444444444444444444444444444444',
  random: '0x5555555555555555555555555555555555555555',
};

test('factory probe treats a separate marketCreator as deploy-ready under Safe ownership', () => {
  const probe = buildFactoryProbeStatus({
    owner: ADDR.safe,
    marketCreator: ADDR.creator,
    resolver: ADDR.resolver,
    collateral: ADDR.collateral,
    deployerAddress: ADDR.creator,
    resolverAddress: ADDR.resolver,
    expectedCollateral: ADDR.collateral,
  });

  assert.equal(probe.deployerIsOwner, false);
  assert.equal(probe.deployerIsMarketCreator, true);
  assert.equal(probe.deployerCanCreate, true);
  assert.equal(probe.resolverMatches, true);
  assert.equal(probe.collateralMatches, true);

  const warnings = [];
  appendFactoryProbeWarnings(warnings, {
    label: 'V1',
    probe: { ...probe, address: ADDR.random, reachable: true },
    deployerAddress: ADDR.creator,
    resolverAddress: ADDR.resolver,
    expectedCollateral: ADDR.collateral,
  });
  assert.deepEqual(warnings, []);
});

test('factory probe warns when Safe ownership strands automatic market creation', () => {
  const probe = buildFactoryProbeStatus({
    owner: ADDR.safe,
    marketCreator: ADDR.safe,
    resolver: ADDR.resolver,
    collateral: ADDR.collateral,
    deployerAddress: ADDR.creator,
    resolverAddress: ADDR.resolver,
    expectedCollateral: ADDR.collateral,
  });
  const warnings = [];

  appendFactoryProbeWarnings(warnings, {
    label: 'V2',
    probe: { ...probe, address: ADDR.random, reachable: true },
    deployerAddress: ADDR.creator,
    resolverAddress: ADDR.resolver,
    expectedCollateral: ADDR.collateral,
  });

  assert.equal(probe.deployerCanCreate, false);
  assert.match(warnings.join('\n'), /V2 factory owner\/marketCreator do not allow ONCHAIN_DEPLOYER_ADDRESS/);
});
