import { Pool } from 'pg';
import { Store, initialState } from './store.js';

const requiredMigrations=[
  '202610010001_initial_ducktown_store',
  '202610010002_seed_ducktown_state'
];

function assertState(state) {
  const collections=['robots','posts','users','sessions','snapshots','receipts','postLikes','postReplies','follows','saves','notifications','reports'];
  if(!state||state.version!==1||collections.some(key=>!Array.isArray(state[key]))) {
    throw new Error('Supabase app_state has an unsupported Ducktown document. Check that all Ducktown migrations were applied.');
  }
  return state;
}

export class PostgresStore extends Store {
  constructor(databaseUrl,dataFile='/tmp/ducktown-supabase.json') {
    super(dataFile);
    if(!databaseUrl)throw new Error('DATABASE_URL is required for the Supabase store');
    let parsed;
    try { parsed=new URL(databaseUrl); }
    catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL'); }
    if(!['postgres:','postgresql:'].includes(parsed.protocol))throw new Error('DATABASE_URL must use PostgreSQL');
    if(!parsed.searchParams.has('sslmode'))parsed.searchParams.set('sslmode','require');
    // Supabase's documented sslmode=require means TLS encryption without CA
    // verification. pg-connection-string currently maps require to verify-full,
    // so opt into its libpq-compatible interpretation to match that contract.
    if(parsed.searchParams.get('sslmode')==='require'&&!parsed.searchParams.has('uselibpqcompat'))parsed.searchParams.set('uselibpqcompat','true');
    this.pool=new Pool({connectionString:parsed.toString(),max:1,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
    this.state=null;
  }

  async open() {
    const client=await this.pool.connect();
    try {
      const migrations=await client.query(
        'select version from ducktown_private.schema_migrations where version = any($1::text[])',
        [requiredMigrations]
      );
      const applied=new Set(migrations.rows.map(row=>row.version));
      const missing=requiredMigrations.filter(version=>!applied.has(version));
      if(missing.length)throw new Error(`Supabase is missing Ducktown migrations: ${missing.join(', ')}. Apply the SQL files in supabase/migrations in order.`);
      const result=await client.query('select document from public.app_state where id=1');
      if(!result.rowCount) {
        const seed=initialState();
        await client.query('insert into public.app_state(id,document) values(1,$1::jsonb) on conflict(id) do nothing',[JSON.stringify(seed)]);
      }
      this.state=assertState((await client.query('select document from public.app_state where id=1')).rows[0]?.document);
    } catch(error) {
      if(error.code==='42P01'||error.code==='42501')throw new Error('Could not find or access Ducktown’s Supabase schema. Apply both migrations using the project owner role, then verify DATABASE_URL.');
      throw error;
    } finally { client.release(); }
  }

  async refresh() {
    const {rows}=await this.pool.query('select document from public.app_state where id=1');
    this.state=assertState(rows[0]?.document);
    return this.state;
  }

  async mutate(callback) {
    const client=await this.pool.connect();
    try {
      await client.query('begin');
      const selected=await client.query('select document from public.app_state where id=1 for update');
      if(!selected.rowCount)throw new Error('Supabase app_state row is missing; apply Ducktown migrations again.');
      const next=structuredClone(assertState(selected.rows[0].document));
      const result=callback(next);
      await client.query('update public.app_state set document=$1::jsonb, revision=revision+1 where id=1',[JSON.stringify(next)]);
      await client.query('commit');
      this.state=next;
      return result;
    } catch(error) {
      await client.query('rollback').catch(()=>{});
      throw error;
    } finally { client.release(); }
  }

  async consumeRateLimit(scope,actor,limit,windowMs,now=Date.now()) {
    const client=await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[scope,actor]);
      await client.query('delete from public.rate_events where at_ms <= $1',[now-24*60*60*1000]);
      const recent=await client.query(
        'select count(*)::int as count, min(at_ms)::bigint as oldest from public.rate_events where scope=$1 and actor=$2 and at_ms>$3',
        [scope,actor,now-windowMs]
      );
      const {count,oldest}=recent.rows[0];
      let result;
      if(count>=limit)result={allowed:false,retryAfter:Math.max(1,Math.ceil((Number(oldest)+windowMs-now)/1000))};
      else {
        await client.query('insert into public.rate_events(scope,actor,at_ms) values($1,$2,$3)',[scope,actor,now]);
        result={allowed:true};
      }
      await client.query('commit');
      return result;
    } catch(error) {
      await client.query('rollback').catch(()=>{});
      throw error;
    } finally { client.release(); }
  }

  async backup() {
    throw new Error('SQLite backup helper cannot back up Supabase. Use Supabase backups or pg_dump.');
  }

  close() { return this.pool.end(); }
}
