# Supabase migrations

Run the SQL files in `migrations/` in timestamp order from Supabase Dashboard →
SQL Editor, using the project owner role. Run each file once, from top to bottom.
Each migration records its version in the private
`ducktown_private.schema_migrations` ledger.

1. `202610010001_initial_ducktown_store.sql` creates the singleton JSONB app
   state, persistent rate-limit event table, index, and browser-role protections.
2. `202610010002_seed_ducktown_state.sql` inserts the default Pepper/demo state
   and validates the current version-1 document shape.

These migrations describe the storage Ducktown currently uses, but **do not**
switch `server/store.js` from SQLite to PostgreSQL, copy any existing SQLite
accounts/posts, or make the current Vercel deployment database-backed. Apply
them only in the Supabase project you intend to use. Do not paste real database
credentials into SQL files or commit them.

After applying, verify in SQL Editor:

```sql
select version, applied_at
from ducktown_private.schema_migrations
order by version;

select id, document->>'version' as app_state_version, revision
from public.app_state;

select to_regclass('public.rate_events') as rate_events_table;
```

Expected: two migration versions, one seeded app-state row at version `1`, and
`public.rate_events` present.
