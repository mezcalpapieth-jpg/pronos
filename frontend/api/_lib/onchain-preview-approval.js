const SEPOLIA_CHAIN_ID = 421614;

// Deployment metadata is server-owned. Never enable this default from a
// request parameter or a VITE_* variable.
export function pendingApprovalSettings(env = process.env) {
  const previewEnabled = env.ONCHAIN_PREVIEW_APPROVALS_ENABLED === 'true'
    && env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === 'onchain-sepolia'
    && Number(env.ONCHAIN_CHAIN_ID) === SEPOLIA_CHAIN_ID;
  return {
    previewEnabled,
    defaultMode: previewEnabled ? 'onchain' : 'points',
    chainId: previewEnabled ? SEPOLIA_CHAIN_ID : null,
  };
}

function approvalError(message, status, detail) {
  return Object.assign(new Error(message), { status, detail });
}

// Only human admin approvals use the preview default. Scheduled approvals
// and existing MVP callers of approveOne keep their explicit options.
export function pendingApprovalOptions(body = {}, env = process.env) {
  const { mode, chainId, chainAddress, chainMarketId, autoDeploy, previewApprovalMode } = body;
  const settings = pendingApprovalSettings(env);
  let opts = { mode, chainId, chainAddress, chainMarketId, autoDeploy };

  if (previewApprovalMode !== undefined) {
    if (!settings.previewEnabled) {
      throw approvalError('preview_approvals_disabled', 403,
        'Preview approval settings are only available on the enabled onchain-sepolia preview.');
    }
    if (previewApprovalMode !== 'points' && previewApprovalMode !== 'onchain') {
      throw approvalError('invalid_preview_approval_mode', 400, 'Choose points or onchain.');
    }
    // The preview selector controls the destination, never contract addresses
    // supplied by the browser. Each approval must deploy its own market.
    opts = previewApprovalMode === 'onchain'
      ? { mode: 'onchain', chainId: SEPOLIA_CHAIN_ID, autoDeploy: true }
      : { mode: 'points' };
  } else if (settings.previewEnabled && mode === undefined) {
    opts = { mode: 'onchain', chainId: SEPOLIA_CHAIN_ID, autoDeploy: true };
  }

  if (settings.previewEnabled && opts.mode === 'onchain'
    && Number(opts.chainId) !== SEPOLIA_CHAIN_ID) {
    throw approvalError('invalid_preview_chain', 400, 'Preview approvals require Arbitrum Sepolia (421614).');
  }
  if (body.action === 'approve_all' && opts.mode === 'onchain') {
    throw approvalError('bulk_approve_onchain_unsupported', 400,
      'On-chain approvals must be done one at a time so each market gets its own chain_address.');
  }
  return opts;
}
