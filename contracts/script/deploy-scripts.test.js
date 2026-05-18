import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('V1 deploy script sets an automatic market creator before Safe ownership transfer', () => {
  const source = read('./DeployProtocol.s.sol');
  const creatorRead = source.indexOf('MARKET_CREATOR_ADDRESS');
  const setCreator = source.indexOf('factory.setMarketCreator(marketCreator)');
  const transferOwner = source.indexOf('factory.transferOwnership(adminAddress)');

  assert.notEqual(creatorRead, -1, 'script should read MARKET_CREATOR_ADDRESS');
  assert.notEqual(setCreator, -1, 'script should set MarketFactory.marketCreator');
  assert.notEqual(transferOwner, -1, 'script should transfer ownership to the Safe/admin');
  assert.ok(setCreator < transferOwner, 'marketCreator must be set before ownership leaves the deployer');
});

test('V2 deploy script mirrors V1 Safe aliases and automatic market creator setup', () => {
  const source = read('./DeployProtocolV2.s.sol');
  const adminSafe = source.indexOf('ADMIN_SAFE_ADDRESS');
  const resolverSafe = source.indexOf('RESOLVER_SAFE_ADDRESS');
  const creatorRead = source.indexOf('MARKET_CREATOR_ADDRESS');
  const requireDeployed = source.indexOf('function requireDeployed');
  const setCreator = source.indexOf('factory.setMarketCreator(marketCreator)');
  const transferOwner = source.indexOf('factory.transferOwnership(adminAddress)');

  assert.notEqual(adminSafe, -1, 'V2 should support ADMIN_SAFE_ADDRESS');
  assert.notEqual(resolverSafe, -1, 'V2 should support RESOLVER_SAFE_ADDRESS');
  assert.notEqual(creatorRead, -1, 'V2 should read MARKET_CREATOR_ADDRESS');
  assert.notEqual(requireDeployed, -1, 'V2 should verify Safe addresses are deployed contracts');
  assert.notEqual(setCreator, -1, 'V2 should set MarketFactoryV2.marketCreator');
  assert.notEqual(transferOwner, -1, 'V2 should transfer ownership to the Safe/admin');
  assert.ok(setCreator < transferOwner, 'marketCreator must be set before ownership leaves the deployer');
});
