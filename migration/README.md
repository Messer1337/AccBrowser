# Firebase → self-hosted data migration

A one-off tool that copies your existing `teamUsers`, `profiles`, and `auditLogs` from
Firestore into the self-hosted Postgres schema, so switching `OASIS_BACKEND` to
`selfhosted` doesn't start the team from zero.

## Before you run it

**Passwords cannot be migrated.** Firebase Auth never exposes a user's real password or
a hash this server could verify — only Firebase itself can check it. This script
generates a random temporary password per account, sets `must_change_password`, and
prints the list once at the end. You are responsible for getting each temporary password
to the right person (Signal, in person, whatever your team already uses for secrets) and
telling them to log in and immediately set a real password — the app will force a
password-change prompt using that flag.

**Active leases are cleared.** If a profile was held by a device in Firestore at the time
of export, that lease is dropped rather than copied — carrying it over could lock
everyone out of a profile the self-hosted server has no way to know is actually still
open.

**This only reads from Firebase.** It never writes to or deletes anything in your
Firestore project.

## 1. Get a Firebase service account key

Firebase Console → Project Settings → Service Accounts → **Generate new private key**.
This downloads a JSON file — treat it like a password (it grants full read access to your
project's data). Do not commit it.

## 2. Set up the self-hosted server first

Run the server's own migrations (`npm run migrate` in `server/`, or `docker compose up`)
so the `users`/`profiles`/`audit_logs` tables already exist before this script writes to
them.

## 3. Run it

```bash
cd migration
npm install

export FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/your-service-account.json
export DATABASE_URL=postgres://oasis:yourpassword@your-server-host:5432/oasis
# (or postgres://oasis:yourpassword@127.0.0.1:5432/oasis if tunneling/port-forwarding in)

npm run migrate:dry-run   # preview counts, writes nothing
npm run migrate           # actually writes; prints temporary passwords at the end
```

Re-running it later (e.g. to pick up a teammate added in Firebase after your first run) is
safe:
- **Accounts**: a temporary password is only ever generated for a username that doesn't
  exist yet on the self-hosted server. An already-migrated account only gets its
  role/allowed-profiles refreshed — its password (temp or already-changed-by-the-user) is
  never touched again.
- **Profiles**: fully re-syncable any time — every write is an upsert keyed by profile id.
- **Audit log history**: only imported the very first time (it's a historical record, not
  live state, and has no natural per-entry key to upsert against) — later runs leave it
  alone rather than duplicating every past entry.

## 4. After it finishes

- Send each printed temporary password to its owner out-of-band, then clear your
  terminal's scrollback.
- Point clients at the self-hosted server (`OASIS_BACKEND=selfhosted`,
  `OASIS_SELFHOSTED_URL=...`) per the main [server/README.md](../server/README.md).
- Once everyone has logged in and rotated their password, delete the service account key
  file you downloaded in step 1.
