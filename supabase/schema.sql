-- LEDGERLINE schema — run this in the Supabase SQL editor (one time).
--
-- v1 persistence: one row per user holding the full app state as JSONB.
-- Every mutation in the app flows through a single update() choke point,
-- so a debounced whole-state upsert is simple and reliable. The state is
-- already structured as relational tables internally; migrating to fully
-- normalised Postgres tables later is a contained change.

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

create policy "read own state"
  on public.user_state for select
  using (auth.uid() = user_id);

create policy "insert own state"
  on public.user_state for insert
  with check (auth.uid() = user_id);

create policy "update own state"
  on public.user_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own state"
  on public.user_state for delete
  using (auth.uid() = user_id);

-- Optional: keep updated_at fresh even if the client forgets to set it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch
  before update on public.user_state
  for each row execute function public.touch_updated_at();
