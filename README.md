# Ducktown

Ducktown is a local social beta for Microduck builders. People can create a simulation duck profile, publish Pond notes, follow other ducks, save Workshop ideas and Arena prompts, reply, and review private simulator receipts before choosing to share a carefully worded summary. The 3D duck and illustrated behaviors are presentation, not robot telemetry.

## Run locally

Requires Node.js 20.20.2 or newer. From this folder, run `npm ci` and `npm start`, then open `http://127.0.0.1:8787/`. `npm start` loads `.env` if present. Without `DATABASE_URL`, the app uses local SQLite; with `DATABASE_URL`, it uses the migrated Supabase Postgres store. Keep `.env` private; `.env.example` contains only placeholders. The app serves only on loopback. `npm test` covers the local API, database, social flows, recovery, moderation, concurrent writes, and SDK failure cases. `npm run build:frontend` builds the browser app. After `npx playwright install chromium`, `npm run test:browser` runs isolated desktop/mobile journeys and automated accessibility checks. `npm run backup:db` makes a consistent SQLite backup; for Supabase, use Supabase backups or `pg_dump`. `npm run rehearse:restore -- /absolute/path/to/BACKUP.sqlite` verifies a copied SQLite backup without replacing live data.

The active data file is `data/ducktown.json.sqlite`. If `data/ducktown.json` already exists, its content is imported once on first start; it remains untouched. Keep `data/`, `work/evidence/`, and the operator token private. See [backend notes](server/README.md) for the SDK observer and the fixed simulator challenge, and [frontend notes](frontend/README.md) for UI development.

## Release boundary

This build is ready for local beta walkthroughs. Public-origin security checks, persisted write limits, backup-restore rehearsal, and browser checks are implemented, but public hosting still needs a configured HTTPS reverse proxy, a deployment rehearsal, and an operations plan for abuse review and monitoring. The app continues to bind only to loopback; do not expose port 8787 directly. No physical Microduck has been tested. A simulator receipt reports only the observed policy transition and return; it does not claim task completion, a measured score, or real-robot safety.

## Vercel boundary

The repository includes `vercel.json` for a **static visual preview**. Import this repository into Vercel with the project root as the Root Directory, or link it with the Vercel CLI. The config runs `npm ci`, builds with `VITE_DUCKTOWN_STATIC_PREVIEW=1 npm run build:frontend`, and serves `dist/frontend`. **No dashboard environment variables are required for this preview.** The preview explicitly labels accounts, shared posts, and robot connections as unavailable; demo notes remain in that visitor's browser only. Do not set `DUCKTOWN_PUBLIC_ORIGIN`, `DUCKTOWN_MICRODUCK_ROOT`, operator tokens, or database credentials on this static project. The local database and simulator data are excluded from Git and from the deploy.

**Do not present this Vercel preview as a live social app yet.** The Node server currently binds to loopback and is not a Vercel Function. More importantly, `better-sqlite3` writes accounts, sessions, posts, reports, and rate limits to a local file; Vercel's function filesystem is [ephemeral and cannot persist a shared SQLite database](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel). The local Pollen SDK simulator and operator-only evidence workflow must remain on a trusted local machine, not be presented as a cloud-connected robot.

Before a public Vercel launch, choose a durable remote database (for example a [Marketplace Postgres or Turso integration](https://vercel.com/docs/marketplace-storage)), migrate and test the store plus rate limits, adapt the public HTTP API to [Vercel Functions](https://vercel.com/docs/functions), then rehearse registration, sign-in, posting, moderation, backups, and failure handling on a preview deployment. Keep the simulator/operator process separate. The current local SQLite backup remains private and must not be committed or bundled into a deployment.
