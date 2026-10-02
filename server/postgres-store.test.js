import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore } from './postgres-store.js';
import { initialState } from './store.js';

const URL_OK = 'postgresql://postgres.example-ref:not-a-real-password@db.example.invalid:5432/postgres';

// A stand-in for pg's Pool: records SQL and answers from a tiny in-memory model.
function fakePool({migrations = ['202610010001_initial_ducktown_store', '202610010002_seed_ducktown_state'], document = initialState(), failUpdate = false} = {}) {
  const log = [];
  const state = {document: structuredClone(document)};
  const query = async (sql, params = []) => {
    log.push(sql.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    if (/schema_migrations/.test(sql)) return {rows: migrations.filter(v => params[0].includes(v)).map(version => ({version})), rowCount: migrations.length};
    if (/select document from public.app_state/.test(sql)) return state.document ? {rows: [{document: structuredClone(state.document)}], rowCount: 1} : {rows: [], rowCount: 0};
    if (/^update public.app_state/.test(sql.trim())) {
      if (failUpdate) throw Object.assign(new Error('write failed'), {code: '08006'});
      state.document = JSON.parse(params[0]);
      return {rowCount: 1};
    }
    return {rows: [], rowCount: 0};
  };
  return {log, state, pool: {query, connect: async () => ({query, release() {}}), end: async () => {}}};
}

test('Postgres store validates DATABASE_URL and enforces TLS without leaking the password', () => {
  assert.throws(() => new PostgresStore(''), /DATABASE_URL is required/);
  assert.throws(() => new PostgresStore('not a url'), /valid PostgreSQL connection URL/);
  assert.throws(() => new PostgresStore('mysql://u:p@h/db'), /must use PostgreSQL/);
  const store = new PostgresStore(URL_OK);
  const url = new URL(store.pool.options.connectionString);
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('uselibpqcompat'), 'true');
  return store.close();
});

test('opening fails with a clear message when a migration is missing', async () => {
  const store = new PostgresStore(URL_OK);
  await store.pool.end();
  store.pool = fakePool({migrations: ['202610010001_initial_ducktown_store']}).pool;
  await assert.rejects(store.open(), /missing Ducktown migrations: 202610010002_seed_ducktown_state/);
});

test('writes are transactional: committed on success, rolled back and state unchanged on failure', async () => {
  const store = new PostgresStore(URL_OK);
  await store.pool.end();
  const ok = fakePool();
  store.pool = ok.pool;
  await store.open();
  await store.mutate(state => { state.posts.push({id: 'p1'}); });
  assert.deepEqual(ok.log.filter(s => /^(begin|commit|rollback)/.test(s)), ['begin', 'commit']);
  assert.equal(ok.state.document.posts.length, 1);
  assert.equal(store.state.posts.length, 1);

  const bad = fakePool({failUpdate: true});
  store.pool = bad.pool;
  await assert.rejects(store.mutate(state => { state.posts.push({id: 'p2'}); }), /write failed/);
  assert.ok(bad.log.includes('rollback'), 'failed write must roll back');
  assert.equal(store.state.posts.length, 1, 'in-memory state must not keep a failed write');
});
