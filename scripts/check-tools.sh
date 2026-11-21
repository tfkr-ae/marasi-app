#!/bin/sh
# The tool contract checks for the integrated CyberChef and Excalidraw,
# separate from check.sh. They drive the real pinned builds in headless
# Chrome through a test-only harness (frontend/tool-harness), with no mocks
# and no Marasi service, then check both tools' licences and the release
# build. Every check is named; a failing one fails the run. Run it before
# every bump of either pin. CI runs it on matching pull requests and nightly
# (.github/workflows/tools.yml).
#
# It assumes scripts/bootstrap.sh has run. It builds CyberChef from its pin
# when frontend/static/tools/cyberchef doesn't match it (a few minutes), and
# needs Chrome (CHROME_BIN, or the usual install paths).
set -eu

cd "$(dirname "$0")/.."

step() {
	printf '\n==> %s\n' "$1"
}

status=0

step 'build CyberChef from its pin'
node frontend/cyberchef/build.js

cd frontend

step 'licences'
node tool-checks/check-licences.js || status=1

step 'build the tool harness'
npx vite build --config tool-harness/vite.config.js

step 'browser checks'
node tool-checks/check-browser.js || status=1

step 'build the release frontend'
npm run build

step 'release build'
node tool-checks/check-release.js || status=1

if [ "$status" -ne 0 ]; then
	printf '\nTool contract checks failed (see FAIL lines above).\n'
	exit 1
fi
printf '\nTool contract checks passed.\n'
