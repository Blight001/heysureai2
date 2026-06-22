#!/usr/bin/env bash
#
# HeySure Workspace bootstrap script (bash/zsh).
#
# Clones the three component repos into web/, server/, device/.
# After this, docker-compose and all launch scripts behave like the old monorepo.
#
# Usage:
#   ./init-env.sh
#
# Override repo base:
#   HEYSURE_REPO_BASE=https://github.com/YourOrg ./init-env.sh
#

set -e

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKSPACE_ROOT"

REPO_BASE="${HEYSURE_REPO_BASE:-https://github.com/Blight001}"
REPO_BASE="${REPO_BASE%/}"

declare -A REPOS=(
  ["HeySure-Web"]="web"
  ["HeySure-Server"]="server"
  ["HeySure-Device"]="device"
)

echo "HeySure workspace bootstrap"
echo "Repo base: $REPO_BASE"
echo

for name in "${!REPOS[@]}"; do
  dir="${REPOS[$name]}"
  url="${REPO_BASE}/${name}.git"
  target="$WORKSPACE_ROOT/$dir"

  if [ -d "$target/.git" ]; then
    echo "[skip] $dir already contains a git repository"
    continue
  fi

  if [ -d "$target" ]; then
    echo "[warn] $dir exists but is not a git repo. Please remove or rename it."
    continue
  fi

  echo "[clone] $name -> $dir"
  git clone "$url" "$target"
done

echo
echo "Bootstrap complete."
echo "You can now run:"
echo "  ./docker-run.bat   (or docker compose up -d --build)"
echo "  ./windows-run.bat"
echo "  server/run.bat"
echo "  web/run.bat"
echo
echo "Remember to copy .env.example → .env and set DATABASE_URL + HEYSURE_INTERNAL_TOKEN."
