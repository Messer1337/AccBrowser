#!/usr/bin/env bash
# Runs the self-hosted server's integration suite against a real, disposable Postgres
# instance. Kept out of `npm run verify` deliberately — same as test:rules/test:functions
# are separate opt-in jobs today, since this one needs Docker.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="postgres://oasis_test:oasis_test@127.0.0.1:55432/oasis_test"
export JWT_SECRET="test-only-secret-please-change-me"

cleanup() {
    docker compose -f docker-compose.test.yml down -v >/dev/null 2>&1
}
trap cleanup EXIT

docker compose -f docker-compose.test.yml up -d --wait
if [ $? -ne 0 ]; then
    echo "Failed to start the test Postgres container." >&2
    exit 1
fi

(cd server && npx node-pg-migrate up) || exit 1
(cd server && npm test)
exit $?
