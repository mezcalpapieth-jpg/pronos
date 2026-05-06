#!/bin/bash
# Wrapper for the @modelcontextprotocol/server-postgres MCP.
#
# Why this exists: invoking `npx -y @modelcontextprotocol/server-postgres
# "$NEON_READ_URL"` worked on modern npm but on older npm (5.x/6.x) the
# CLI tries to parse the URL-shaped argument as a package spec, fails,
# and DUMPS THE FULL URL TO STDERR — including the password. That stderr
# is captured by Claude Code and shown to the user/transcript. This
# wrapper avoids npx for the hot path so a credential never appears in
# any error message from npm itself.
#
# Order of preference (first hit wins):
#   1. Global binary `mcp-server-postgres` if present (best — no npm).
#   2. Direct node invocation against the globally-installed package.
#   3. Fallback to npx (only safe on modern npm, but kept for portability).
#
# To install once and skip npx forever:
#   npm install -g @modelcontextprotocol/server-postgres

set -e

if [ -z "$NEON_READ_URL" ]; then
  echo '[postgres-mcp] NEON_READ_URL is not set in env' >&2
  echo '[postgres-mcp] Fix on macOS: launchctl setenv NEON_READ_URL "$NEON_READ_URL"' >&2
  echo '[postgres-mcp] then restart Claude Code so the GUI launch inherits it.' >&2
  exit 1
fi

PKG="@modelcontextprotocol/server-postgres"

# 1. Direct binary on PATH
if command -v mcp-server-postgres >/dev/null 2>&1; then
  exec mcp-server-postgres "$NEON_READ_URL"
fi

# 2. Global install via npm root
GLOBAL_ROOT="$(npm root -g 2>/dev/null || true)"
if [ -n "$GLOBAL_ROOT" ] && [ -f "$GLOBAL_ROOT/$PKG/dist/index.js" ]; then
  exec node "$GLOBAL_ROOT/$PKG/dist/index.js" "$NEON_READ_URL"
fi

# 3. Last-resort npx. On older npm this can leak the URL in error
#    output if the install fails. Safer fallback than nothing, but
#    install globally to avoid hitting this path.
exec npx -y "$PKG" "$NEON_READ_URL"
