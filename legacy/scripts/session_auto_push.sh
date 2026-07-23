#!/usr/bin/env bash
# Session-scoped auto commit + push watcher for ACP_AGENT2

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

INTERVAL=${AUTO_PUSH_INTERVAL:-30}
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)

echo "[auto-push] watching $REPO_ROOT on branch $BRANCH every ${INTERVAL}s"

while true; do
  sleep "$INTERVAL"

  # Skip if not a git repo
  git rev-parse --git-dir >/dev/null 2>&1 || continue

  # Check for any changes, including untracked files
  if [ -z "$(git status --porcelain)" ]; then
    continue
  fi

  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[auto-push] changes detected at $TIMESTAMP, committing..."

  git add -A
  if git commit -m "auto: update at $TIMESTAMP"; then
    if git push origin "$BRANCH"; then
      echo "[auto-push] pushed to origin/$BRANCH"
    else
      echo "[auto-push] push failed, will retry later"
    fi
  else
    echo "[auto-push] commit failed, will retry later"
  fi
done
