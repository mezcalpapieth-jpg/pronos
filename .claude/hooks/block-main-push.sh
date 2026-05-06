#!/bin/bash
# PreToolUse hook for the Bash tool: blocks `git push ... main` to protect
# the public-repo main branch from accidental direct pushes. The active
# branch is `points-app`; pushes to main should only happen via PR merge.
#
# Hook contract: receives JSON on stdin, exits 0 to allow the tool call,
# exits 2 to block (and stderr is shown to the model).
#
# Pattern matches: `git push origin main`, `git push --force main`,
#   `git push -u origin main`, `git push main`, etc.
# Does NOT match: `git push origin points-app`, anything not pushing to main.

set -e
input=$(cat)

# Look for `git push` plus `main` (as a word) anywhere in the command.
# We grep on the raw JSON to avoid jq dependency. Two anchors to lower
# the chance of a false-positive: must contain `git`+space+`push`, AND
# must reference `main` as a separate word (not e.g. `mainline`).
if echo "$input" | grep -qE 'git[[:space:]]+push' \
   && echo "$input" | grep -qE '\bmain\b'; then
  echo "BLOCKED: refusing to push to main on the public repo." >&2
  echo "Use the points-app branch and merge via PR if you need main updated." >&2
  echo "If this is intentional, run the git command outside Claude Code." >&2
  exit 2
fi

exit 0
