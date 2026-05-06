#!/bin/bash
# Wrapper for the @modelcontextprotocol/server-postgres MCP.
#
# Two compounding issues this wrapper handles:
#
# 1. PATH starvation under MCP spawn. Claude Code starts MCP servers
#    under a minimal environment that may not include /opt/homebrew/bin
#    or the user's ~/.npm-global/bin, so plain `node`, `npm`, and `npx`
#    aren't on PATH. We resolve a usable Node binary and the package's
#    dist/index.js by absolute path before exec'ing — no PATH lookups.
#
# 2. URL-shaped argument leak. Older npm versions (5.x/6.x) parse a
#    `postgresql://...` argument to `npx` as a package URL, fail, and
#    print the FULL argument (password and all) to stderr. Skipping npx
#    entirely — invoking node directly on the package's index.js — is
#    the only way to keep the credential out of npm's error path.
#
# Read NEON_READ_URL from env. On macOS GUI launches of Claude Code,
# you need `launchctl setenv NEON_READ_URL "$NEON_READ_URL"` so the
# variable is inherited; the user's ~/.zshrc only exports to terminal
# subprocesses.

set -e

if [ -z "$NEON_READ_URL" ]; then
  echo '[postgres-mcp] NEON_READ_URL is not set in env' >&2
  echo '[postgres-mcp] Fix on macOS: open a terminal where the var is set, then' >&2
  echo '[postgres-mcp]   launchctl setenv NEON_READ_URL "$NEON_READ_URL"' >&2
  echo '[postgres-mcp] and restart Claude Code so the GUI launch inherits it.' >&2
  exit 1
fi

# 1. Find a Node binary (v16+) without using PATH. Tries common install
#    locations in priority order. We require v16+ because the postgres
#    MCP package uses ES module imports.
NODE_BIN=""
for candidate in \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME/.volta/bin/node"
do
  if [ -x "$candidate" ]; then
    v=$("$candidate" --version 2>/dev/null)
    case "$v" in
      v[2-9][0-9].*|v1[6-9].*) NODE_BIN="$candidate"; break ;;
    esac
  fi
done

# Glob expansion for nvm / fnm install layouts (paths vary per version).
if [ -z "$NODE_BIN" ]; then
  for candidate in $HOME/.nvm/versions/node/*/bin/node $HOME/Library/Caches/fnm_multishells/*/bin/node; do
    if [ -x "$candidate" ]; then
      v=$("$candidate" --version 2>/dev/null)
      case "$v" in
        v[2-9][0-9].*|v1[6-9].*) NODE_BIN="$candidate"; break ;;
      esac
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo '[postgres-mcp] No Node v16+ found at common install paths.' >&2
  echo '[postgres-mcp] Searched: /opt/homebrew/bin/node, /usr/local/bin/node,' >&2
  echo '[postgres-mcp]           ~/.volta/bin/node, ~/.nvm/versions/node/*/bin/node' >&2
  exit 1
fi

# 2. Find the postgres MCP package index.js without using PATH.
PKG_INDEX=""
for root in \
  "$HOME/.npm-global/lib/node_modules" \
  /opt/homebrew/lib/node_modules \
  /usr/local/lib/node_modules \
  "$($NODE_BIN -e 'try{console.log(require("path").join(process.execPath,"..","..","lib","node_modules"))}catch(e){}' 2>/dev/null)"
do
  if [ -n "$root" ] && [ -f "$root/@modelcontextprotocol/server-postgres/dist/index.js" ]; then
    PKG_INDEX="$root/@modelcontextprotocol/server-postgres/dist/index.js"
    break
  fi
done

if [ -z "$PKG_INDEX" ]; then
  echo '[postgres-mcp] @modelcontextprotocol/server-postgres not installed globally.' >&2
  echo '[postgres-mcp] Install with: npm install -g @modelcontextprotocol/server-postgres' >&2
  exit 1
fi

exec "$NODE_BIN" "$PKG_INDEX" "$NEON_READ_URL"
