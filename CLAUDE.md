Codex will review your output once you are done.
Use maximum reasoning.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that your changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Pronos project conventions

This is a prediction-markets app deployed on Vercel. Two apps share one repo:

- **`/frontend/app/`** — older Vite app at `pronos.io` root (the soft-gated MVP)
- **`/frontend/app/points/`** — active "Points" off-chain app (the one Fran ships to today)
- **`/frontend/contracts/`** — Foundry contracts (Arbitrum/Base Sepolia testnet)
- **Backend**: Vercel serverless functions in `/frontend/api/**`, Neon Postgres
- **Auth (points-app)**: email-OTP via Turnkey → HMAC-signed session cookie (`/frontend/api/_lib/session.js`, `/frontend/api/points/auth/{init-otp,verify-otp,me,logout,username}.js`). Turnkey also manages the user's wallet (sub-organization). 30-day cookie, HttpOnly, Secure in prod, SameSite=Lax.
- **Auth (older MVP at `pronos.io` root)**: still has legacy `privy_id`-based code in `/frontend/api/user.js` + `/frontend/api/_lib/admin.js`. Don't rely on Privy as the active provider — it's been replaced. Treat those legacy fields as historical artifacts.
- **Soft gate** (MVP "coming soon" page): server-side `/api/gate` (or `/api/mvp-access` on points-app) checking `MVP_ACCESS_PASSWORD` against an HMAC cookie signed with `MVP_ACCESS_SECRET`.

### Branching

- **`points-app`** is the active deploy branch — Vercel ships from it. Always commit there.
- **`main`** is stale; do NOT push to it directly. The `.claude/hooks/block-main-push.sh` hook enforces this and will reject any `git push ... main` from inside Claude Code.
- Worktrees at `/Users/Fran/pronos/.claude/worktrees/*` are Claude's per-session checkouts; the source-of-truth tree is `/Users/Fran/pronos` itself. When editing files, prefer paths under `/Users/Fran/pronos/...` directly so changes land on `points-app` and don't drift.

### MCPs available (configured in `/.mcp.json`)

- **`postgres`** — read-only Neon connection (uses `$NEON_READ_URL`). Use this for any "is the data actually in the DB?" question instead of guessing or asking the user. Examples: verify a market is in `status='resolved'`, count rows by category, check which schema migrations have run.
- **`vercel`** — deploy logs, env-var presence, function invocations. Use this when an endpoint 500s or when you need to verify an env var (e.g. `MVP_ACCESS_PASSWORD`) is actually set in production.
- **`sentry`** — production runtime errors. Use this proactively when Fran says "X stopped working" instead of guessing from code.

If a tool call fails because the server isn't connected, tell Fran which MCP needs OAuth + the URL — don't keep falling back to manual curl.

### Slash commands available (in `/.claude/commands/`)

- **`/deploy-verify`** — run the post-deploy smoke test. Invoke this every time after `git push origin points-app` to catch env-var misses, broken endpoints, missing rewrites.
- **`/news-debug`** — diagnose the news feed (per-outlet count, timestamp health, classifier coverage). Run when Fran reports any news issue before reading code.
- **`/db-rows`** — quick row-count + recent-row inspection. Prefer the `postgres` MCP path; fall back to the admin diagnostic endpoint.

Use these proactively. They exist specifically because reasoning about live state from code-only is unreliable.

### Other conventions

- **Local Vite preview is broken** for Pronos — CSS doesn't render correctly. Verify on `pronos.io` after deploy, not locally.
- **`window.location.href` causes 404s** for non-root SPA paths in points-app — always use React Router's `useNavigate`.
- **Canonicalize URLs** before storing/looking up in `points_news_links` / `points_news_hidden` (strip `utm_*`, `oc=`, `fbclid`, trailing slash, fragment). Helper: `canonicalizeUrl()` in `/frontend/api/_lib/news-mexico.js`.
- **`ADMIN_USERNAMES`, `MVP_ACCESS_PASSWORD`, `MVP_ACCESS_SECRET`** are server-side env vars on Vercel (never client-bundled). Don't reintroduce hardcoded fallbacks — the security model assumes Vercel-only configuration.
- **Repo is public** as of 2026-05-05. Don't write secrets, real env values, or PII into any committed file.

