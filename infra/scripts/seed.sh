#!/usr/bin/env bash
set -euo pipefail
STAGE="${1:-local}"
echo "Seeding data for stage: ${STAGE}"
pnpm exec tsx scripts/seed.ts --stage "${STAGE}"
