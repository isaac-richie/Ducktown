// Vercel Function: serves Ducktown's /api/v1/* (via the rewrite in vercel.json) with the same
// server code as `npm start`.
// Static pages come from the Vite build (dist/frontend); only the API runs here.
import { createApp } from '../server/app.js';

let app = null;

function publicOrigin() {
  if (process.env.DUCKTOWN_PUBLIC_ORIGIN) return process.env.DUCKTOWN_PUBLIC_ORIGIN;
  // Production answers on the project's production domain; previews on their own deployment URL.
  const host = process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

async function getApp() {
  if (!process.env.DATABASE_URL) {
    // Never fall back to SQLite on Vercel: its disk is temporary, so accounts would vanish.
    throw new Error('DATABASE_URL is not set for this Vercel environment. Run scripts/vercel-env.sh.');
  }
  app ??= createApp({
    publicOrigin: publicOrigin(),
    dataFile: '/tmp/ducktown/ducktown.json', // only the per-instance operator token lives here
    trustProxy: true
  }).then(({server}) => server.listeners('request')[0]);
  return app;
}

// vercel.json rewrites /api/v1/<path> to /api/index?__path=<path>; restore the original URL so the
// app routes exactly as it does under `npm start` (nested paths like /api/v1/auth/login included).
function restoreUrl(req) {
  const url = new URL(req.url, 'http://local');
  const path = url.searchParams.get('__path');
  if (path === null) return;
  url.searchParams.delete('__path');
  req.url = `/api/v1/${path}${url.search}`;
}

export default async function handler(req, res) {
  restoreUrl(req);
  try {
    const handle = await getApp();
    return handle(req, res);
  } catch (error) {
    app = null; // retry initialisation on the next request (e.g. Supabase briefly unreachable)
    console.error('Ducktown API failed to start:', error.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({error: 'Ducktown is starting up or misconfigured. Please try again shortly.'}));
  }
}
