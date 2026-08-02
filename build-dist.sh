#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm use 20 2>/dev/null || { echo "node 20 not found via nvm, using system node"; }

npx tsx scripts/build-icon-sprite.ts
npx tsc -b
npx vite build
