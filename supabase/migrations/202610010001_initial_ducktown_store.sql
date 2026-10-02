-- Ducktown's first PostgreSQL schema.
-- Apply in Supabase SQL Editor as the project owner. This mirrors the current
-- SQLite Store's storage model; it does not migrate existing local SQLite data
-- or switch the running Node server to PostgreSQL.

begin;

create schema if not exists ducktown_private;

create table if not exists ducktown_private.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.app_state (
  id smallint primary key default 1 check (id = 1),
  document jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint app_state_document_is_object check (jsonb_typeof(document) = 'object')
);

create table if not exists public.rate_events (
  scope text not null check (length(scope) between 1 and 120),
  actor text not null check (length(actor) between 1 and 240),
  at_ms bigint not null check (at_ms > 0)
);

create index if not exists rate_events_lookup
  on public.rate_events (scope, actor, at_ms);

-- Browser-facing Supabase roles must not read or modify app data directly.
-- Ducktown's trusted server will use its database connection, never a browser key.
alter table public.app_state enable row level security;
alter table public.rate_events enable row level security;

revoke all on table public.app_state, public.rate_events from public, anon, authenticated;
revoke all on schema ducktown_private from public, anon, authenticated;

insert into ducktown_private.schema_migrations (version)
values ('202610010001_initial_ducktown_store')
on conflict (version) do nothing;

commit;
