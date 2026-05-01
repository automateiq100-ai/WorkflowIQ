#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install root + workspace deps (npm workspaces handles accountingiq, practiceiq, researchiq)
npm install --no-audit --no-fund

# The root `build` script does explicit installs for the Next.js sub-apps to make sure
# their package-lock.jsons are honoured. Mirror that here so dev mode has everything.
npm install --no-audit --no-fund --prefix accountingiq
npm install --no-audit --no-fund --prefix practiceiq
