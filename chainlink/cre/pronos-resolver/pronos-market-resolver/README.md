# Pronos Market Resolver CRE Workflow

This is the first Chainlink CRE scaffold for Pronos market resolution. It is
simulation-only for now: the workflow produces a deterministic dry-run
resolution report and does not call Pronos contracts or write onchain.

## Current Boundary

The cron trigger returns a report shaped for the future resolver adapter:

- `resolverType: "chainlink-cre"` for deterministic sources, or
  `resolverType: "chainlink-cre-ai"` for sentiment / ambiguous markets
- `status: "ready" | "dry-run" | "candidate"`
- market source identity: `source`, `sourceEventId`, `protocolMarketId`
- selected `outcomeIndex` and `outcomeCount`
- confidence in basis points
- CRE runtime `observedAt`
- optional final score
- evidence URL, optional evidence snippets, and rationale

This lets us wire and test the product boundary before adding external data
consensus, EVM reads, and guarded onchain writes.

AI reports should use `status: "candidate"`. The Pronos API stores them as
resolution candidates for admin review; it does not settle funds until an admin
presses `Confirmar resolución`.

## Local Commands

Run these from this workflow folder:

```bash
bun install
bun test
bun run typecheck
```

Run CRE simulation from the project root, one directory above this workflow:

```bash
cd ..
cre workflow simulate pronos-market-resolver --target staging-settings
```

In Codex shells where PATH has not reloaded yet, use the direct binaries:

```bash
/Users/Fran/.cre/bin/cre workflow simulate pronos-market-resolver --target staging-settings
```

## Before Deployment

Do not deploy this workflow as-is. Before deployment we still need:

- a real sports or crypto data fetch step with CRE consensus behavior
- CRE submission to `/api/protocol/cre/resolve-market`
- `CRE_RESOLUTION_WEBHOOK_SECRET` moved into CRE secret management
- testnet simulation with real target config
- Deploy Access enabled in the Chainlink CRE account
