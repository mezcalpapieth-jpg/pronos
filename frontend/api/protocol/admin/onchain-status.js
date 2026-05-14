/**
 * GET /api/protocol/admin/onchain-status
 *
 * Protocol-admin alias for the on-chain pre-flight checker. The
 * implementation still lives in the points admin tree because pending
 * market approval uses the same deployer/factory readiness probe.
 */
export { default } from '../../points/admin/onchain-status.js';
