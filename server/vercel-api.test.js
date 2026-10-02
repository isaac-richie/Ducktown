import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('Vercel API refuses to run without DATABASE_URL instead of using a temporary SQLite file', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const original = console.error; console.error = () => {};
  try {
    const {default: handler} = await import('../api/index.js');
    const server = http.createServer(handler).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/health`);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /misconfigured/);
    server.close();
  } finally {
    console.error = original;
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test('Vercel rewrite: nested API paths reach the app with their original URL', async () => {
  const {default: handler} = await import('../api/index.js');
  const seen = [];
  const req = {url: '/api/index?__path=auth/login&x=1'}, res = {setHeader() {}, end() {}};
  const saved = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const original = console.error; console.error = () => {};
  try { await handler(req, res); } finally { console.error = original; if (saved !== undefined) process.env.DATABASE_URL = saved; }
  seen.push(req.url);
  assert.deepEqual(seen, ['/api/v1/auth/login?x=1']);
});
