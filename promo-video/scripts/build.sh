#!/usr/bin/env sh
# Rebuild the app scene from the template, measure it and pull Didi's latest look.
set -e
cd "$(dirname "$0")/.."
PUPPETEER="${PUPPETEER:-$(ls -d "$LOCALAPPDATA"/npm-cache/_npx/*/node_modules/puppeteer 2>/dev/null | head -1)}"
node scripts/make-app.mjs
node scripts/measure-ui.mjs "$PUPPETEER" > /dev/null
node scripts/sync-didi.mjs
