-- Seed the same demo state used by server/store.js on a fresh SQLite install.
-- This lets a future Postgres Store start with the same Pepper profile.

begin;

insert into public.app_state (id, document)
values (
  1,
  '{
    "version": 1,
    "robots": [{
      "id": "pepper",
      "name": "Pepper",
      "mode": "simulation",
      "hardwareConnected": false,
      "owner": "local-demo"
    }],
    "posts": [],
    "users": [],
    "sessions": [],
    "snapshots": [],
    "receipts": [],
    "postLikes": [],
    "postReplies": [],
    "follows": [],
    "saves": [],
    "notifications": [],
    "reports": []
  }'::jsonb
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_state_document_v1_shape'
      and conrelid = 'public.app_state'::regclass
  ) then
    alter table public.app_state
      add constraint app_state_document_v1_shape check (
        document->>'version' = '1'
        and jsonb_typeof(document->'robots') = 'array'
        and jsonb_typeof(document->'posts') = 'array'
        and jsonb_typeof(document->'users') = 'array'
        and jsonb_typeof(document->'sessions') = 'array'
        and jsonb_typeof(document->'snapshots') = 'array'
        and jsonb_typeof(document->'receipts') = 'array'
        and jsonb_typeof(document->'postLikes') = 'array'
        and jsonb_typeof(document->'postReplies') = 'array'
        and jsonb_typeof(document->'follows') = 'array'
        and jsonb_typeof(document->'saves') = 'array'
        and jsonb_typeof(document->'notifications') = 'array'
        and jsonb_typeof(document->'reports') = 'array'
      );
  end if;
end;
$$;

create or replace function ducktown_private.touch_app_state_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_state_touch_updated_at on public.app_state;
create trigger app_state_touch_updated_at
before update on public.app_state
for each row execute function ducktown_private.touch_app_state_updated_at();

insert into ducktown_private.schema_migrations (version)
values ('202610010002_seed_ducktown_state')
on conflict (version) do nothing;

commit;
