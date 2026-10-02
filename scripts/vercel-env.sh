#!/usr/bin/env bash
# Copy Ducktown's server secrets from .env into Vercel's encrypted environment variables.
# Nothing is printed or written to the repo. Requires: `npx vercel login` and `npx vercel link` first.
#
# Usage: scripts/vercel-env.sh [production|preview|both]   (default: both)
set -euo pipefail
cd "$(dirname "$0")/.."

targets="${1:-both}"
[ -f .env ] || { echo "No .env found. Copy .env.example to .env and fill it in." >&2; exit 1; }
[ -f .vercel/project.json ] || { echo "Not linked to a Vercel project. Run: npx vercel link" >&2; exit 1; }

url="$(node -e '
  process.loadEnvFile(".env");
  const raw = process.env.DATABASE_URL;
  if (!raw) { console.error("DATABASE_URL is missing from .env"); process.exit(1); }
  const u = new URL(raw);
  // Serverless functions open short-lived connections: use Supabase'"'"'s transaction pooler (6543)
  // on the same pooler host. The local long-running server keeps the session pooler (5432).
  if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "5432") u.port = "6543";
  process.stdout.write(u.toString());
')"

add() { # $1 = environment
  npx --yes vercel env rm DATABASE_URL "$1" --yes >/dev/null 2>&1 || true
  printf %s "$url" | npx --yes vercel env add DATABASE_URL "$1" >/dev/null
  echo "DATABASE_URL set for $1 (transaction pooler)."
}

case "$targets" in
  production) add production ;;
  preview) add preview ;;
  both) add production; add preview ;;
  *) echo "Usage: $0 [production|preview|both]" >&2; exit 1 ;;
esac
echo "Done. Redeploy for the change to take effect: npx vercel --prod (or push to main)."
