#!/usr/bin/env bash
# Install the onboard-to-flow-sso skill for Claude Code on THIS machine.
#
# Resolves the repo's own location at runtime and links the skill into
# $HOME/.claude/skills — so it works no matter where you cloned flow-auth,
# and `git pull` keeps the skill current (symlink mode, the default).
#
#   ./install.sh          # symlink (recommended — auto-updates on git pull)
#   ./install.sh --copy   # copy instead (no symlink; re-run to update)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$REPO/skill/onboard-to-flow-sso"
DEST_DIR="$HOME/.claude/skills"
DEST="$DEST_DIR/onboard-to-flow-sso"

if [ ! -f "$SKILL_SRC/SKILL.md" ]; then
  echo "ERROR: $SKILL_SRC/SKILL.md not found — run this from inside the flow-auth clone." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST"   # replace any prior install (stale symlink or copy)

if [ "${1:-}" = "--copy" ]; then
  cp -R "$SKILL_SRC" "$DEST"
  echo "Copied skill → $DEST  (re-run ./install.sh to update after a git pull)"
else
  ln -s "$SKILL_SRC" "$DEST"
  echo "Linked skill → $DEST → $SKILL_SRC  (git pull keeps it current)"
fi

echo "Reload skills in Claude Code (or restart the session) to pick it up."
