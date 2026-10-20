#!/usr/bin/env sh
# Applies everything a deployment needs once the code is in place:
#
#   1. database migrations
#   2. the built-in access presets (the four project role levels)
#   3. the derived task values (weight -> priority, progress -> status)
#
# Both seeds are additive and idempotent. They add only what is missing and
# recalculate the values the derivation rules own, so this script is safe to
# run on every deploy.
#
# The one exception is the weight reset: it only happens when
# RESET_TASK_WEIGHTS=1 is set explicitly, which is a deliberate, one-time
# action and is never part of a normal deploy.
#
# Usage:
#   ./scripts/post-deploy.sh [knexfile] [environment]
#
# The database connection variables (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)
# must be present in the environment, the same way the API reads them.
set -e

KNEXFILE="${1:-knexfile.js}"
ENVIRONMENT="${2:-production}"
cd "$(dirname "$0")/.."

echo "==> Applying migrations (${ENVIRONMENT})"
./node_modules/.bin/knex migrate:latest --knexfile "${KNEXFILE}" --env "${ENVIRONMENT}"

echo "==> Installing the built-in access presets"
./node_modules/.bin/knex seed:run --knexfile "${KNEXFILE}" --env "${ENVIRONMENT}" --specific=access_presets_seed.js

echo "==> Recalculating derived task values"
./node_modules/.bin/knex seed:run --knexfile "${KNEXFILE}" --env "${ENVIRONMENT}" --specific=recalculate_task_derivation_seed.js

echo "==> Deploy steps complete"
