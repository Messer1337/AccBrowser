# AccBrowser self-hosted backend

A drop-in alternative to Firebase for AccBrowser (OASIS Browser): the same team-shared
profile leasing, optimistic-concurrency cookie sync, and admin ACL model, running on your
own Linux box via Docker instead of Google's infrastructure.

## Deploy (clean Linux + Docker box)

From the repo root:

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), ADMIN_PASSWORD, OASIS_DOMAIN

docker compose up -d --build
```

This starts four containers:
- `postgres` — the database (`profiles`, `users`, `audit_logs`).
- `api` — this server. On first start it runs migrations, then creates the `ADMIN_USERNAME`
  bootstrap admin (only if it doesn't already exist), then starts listening on `:3000`.
- `caddy` — reverse proxy in front of `api`, handling both REST and the Socket.IO
  WebSocket upgrade. If `OASIS_DOMAIN` is a real domain, Caddy automatically provisions
  and renews a Let's Encrypt TLS certificate for it.
- `postgres-backup` — a daily `pg_dump` with automatic rotation (7 daily / 4 weekly /
  6 monthly), written to `./backups` on the host. See **Backups & restore** below.

After the first successful start, **clear `ADMIN_PASSWORD` from `.env`** — the bootstrap
script only fires when that username doesn't exist yet, so leaving a password there is
harmless but unnecessary.

## Point the Electron client at it

On each machine running AccBrowser:

```bash
OASIS_BACKEND=selfhosted OASIS_SELFHOSTED_URL=https://your-domain npm start
```

(or set these as persistent environment variables / in a launch script). Omitting
`OASIS_BACKEND` keeps the default Firebase path unchanged.

With a real `OASIS_DOMAIN`, Caddy provisions a trusted Let's Encrypt certificate and this
just works. If you leave `OASIS_DOMAIN` as `localhost` for local testing, Caddy serves a
self-signed certificate that Node's `fetch`/Socket.IO client will reject by default —
either point the client at `http://<host>:3000` directly (see the "no Docker" flow below,
or temporarily publish the `api` service's port), or trust Caddy's local CA on the client
machine.

## Local development / testing without a real domain

Leave `OASIS_DOMAIN` unset in `.env` (defaults to `localhost`) and point the client at
`http://localhost` (Caddy will serve plain HTTP for `localhost`), or run the API directly:

```bash
cd server
npm install
cp .env.example .env   # DATABASE_URL pointing at a local Postgres, JWT_SECRET set
npm run migrate
npm run bootstrap-admin
npm start
```

## Backups & restore

`postgres-backup` writes compressed dumps to `./backups/{daily,weekly,monthly,last}` —
`./backups/daily/oasis-latest.sql.gz` always points at the most recent one. This alone
only protects you against DB corruption, a bad migration, or `docker compose down -v` by
accident — it does **not** protect against losing the whole host (disk failure, server
gone). Point a regular off-box sync (`rclone`, `rsync` to another machine, a cloud-drive
client) at `./backups` on whatever schedule you're comfortable losing — daily is the
matching granularity here.

**Restore** (e.g. after a corrupted volume or moving to a new host):

```bash
docker compose down            # keep -v off unless you're deliberately wiping the volume
docker compose up -d postgres  # bring only Postgres up first
# wait for it to report healthy: docker compose ps

gunzip -c backups/daily/oasis-latest.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

docker compose up -d           # start api + caddy + postgres-backup again
```

This was verified end-to-end (create a profile → force a backup → wipe the volume →
restore → confirm the profile and its revision came back) before shipping.

## Operational notes

- **Not hot-swappable**: the Electron client reads `OASIS_BACKEND` once at startup.
  Switching backends while browsers hold active leases is unsupported.
- **Single instance, no HA**: Postgres and `api` are each a single container with no
  replication or failover. If the host goes down, the team is offline until someone
  restarts it (or restores onto a new host from the latest backup above) — accepted
  tradeoff for a small team; full replication/multi-instance is a much bigger lift this
  project intentionally doesn't take on.
- Socket.IO runs without the Redis adapter, which is fine for one `api` replica. If you
  ever do need to scale `api` horizontally, add `@socket.io/redis-adapter` first —
  otherwise live cookie push/lease events won't reach clients connected to a different
  replica.
- **Password format**: this server verifies plaintext passwords directly over TLS and
  stores the same `scrypt$16384$8$1$<salt>$<hash>` format the Electron client's local
  verifier already uses — no separate derived-credential scheme is needed here, unlike
  the Firebase path (which never receives the real plaintext).

## Migrating existing data from Firebase

Switching `OASIS_BACKEND` to `selfhosted` starts from an empty database (aside from the
bootstrap admin) — it does not read your Firebase project. See
[`migration/README.md`](../migration/README.md) for a one-off script that copies existing
profiles, team accounts, and audit history over. Passwords cannot be carried across (see
that README for why) — migrated accounts get a temporary password you distribute
out-of-band.
