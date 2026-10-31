-- =====================================================================
-- ReRoom · Supabase schema (P3 · Backend Lead)
-- Scope: LIVING ROOM ONLY · styles: Modern, Traditional, Boho, Mediterranean
--
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run on a fresh project. To start over, run the
-- "RESET" block at the very bottom first.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. STYLES  (lookup table — the front end reads style cards from here,
--    the edge function reads prompt text from here. Adding a style
--    later = one INSERT, no schema change.)
-- ---------------------------------------------------------------------
create table if not exists public.styles (
  slug         text primary key,               -- what gets stored in makeovers.style
  name         text not null,                  -- label shown on the card
  tagline      text not null,                  -- one-line card description
  prompt_desc  text not null,                  -- goes into P4's image prompt {style_description}
  swatches     text[] not null,                -- 3 hex colours for the card strip
  preview_path text,                           -- optional: path of preview image in storage
  sort_order   int  not null default 0
);

insert into public.styles (slug, name, tagline, prompt_desc, swatches, sort_order) values
  ('modern', 'Modern',
   'Clean lines, calm neutrals, nothing extra.',
   'Clean lines, a white, warm grey and black palette, a low-profile sofa, glass and matte-metal accents, a simple geometric rug, minimal decor and one statement floor lamp.',
   array['#F4F4F2','#8A8D8F','#1F1F1F'], 1),
  ('traditional', 'Traditional',
   'Warm wood, classic shapes, timeless comfort.',
   'Rich dark wood furniture, a rolled-arm sofa, a symmetrical layout, warm cream walls with deep navy and burgundy accents, a patterned Persian-style rug, table lamps with fabric shades and framed classic art.',
   array['#EFE6D6','#7A4A2E','#2B3A55'], 2),
  ('boho', 'Boho',
   'Layered, plant-filled and full of texture.',
   'Layered rugs, rattan and wicker furniture, macramé wall hangings, lots of plants, rust, ochre and terracotta tones, patterned cushions and floor poufs.',
   array['#E9DCC9','#B5562F','#C8962E'], 3),
  ('mediterranean', 'Mediterranean',
   'Sun-baked plaster, terracotta and sea blue.',
   'Warm white limewash-look walls, terracotta and sand tones with deep sea-blue accents, natural wood and wrought-iron details, linen slipcovered seating, woven textiles, ceramic vases and potted olive trees.',
   array['#F3ECE0','#C4673D','#1F4E79'], 4)
on conflict (slug) do update set
  name = excluded.name, tagline = excluded.tagline, prompt_desc = excluded.prompt_desc,
  swatches = excluded.swatches, sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------
-- 2. ROOMS  (one row per uploaded photo)
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null default 'Living room',
  -- Locked to living room for the hackathon. To open up later, just
  -- drop/replace this check constraint — no column changes needed.
  room_type     text not null default 'living_room'
                constraint rooms_living_room_only check (room_type = 'living_room'),
  original_path text not null,
  created_at    timestamptz not null default now(),
  unique (id, user_id)            -- lets makeovers prove they belong to the same user
);

create index if not exists rooms_user_created_idx on public.rooms (user_id, created_at desc);


-- ---------------------------------------------------------------------
-- 3. MAKEOVERS  (one row per generated concept; is_saved = gallery)
-- ---------------------------------------------------------------------
create table if not exists public.makeovers (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  style         text not null references public.styles(slug),
  refresh_level text not null default 'light' check (refresh_level in ('light','full')),
  status        text not null default 'generating' check (status in ('generating','done','failed')),
  error         text,
  image_path    text,
  palette       jsonb,
  tips          jsonb,
  is_saved      boolean not null default false,
  prompt        text,
  created_at    timestamptz not null default now(),
  -- A makeover can only point at a room owned by the same user.
  foreign key (room_id, user_id) references public.rooms (id, user_id) on delete cascade
);

create index if not exists makeovers_gallery_idx on public.makeovers (user_id, is_saved, created_at desc);
create index if not exists makeovers_room_idx    on public.makeovers (room_id);


-- ---------------------------------------------------------------------
-- 4. GENERATION LOG  (daily limit that survives deletes)
--    Counting makeovers rows would let a user delete rows to reset the
--    limit, so the edge function logs every attempt here instead.
--    No RLS policies = invisible to the browser; only the service role
--    (edge function) can write it.
-- ---------------------------------------------------------------------
create table if not exists public.generation_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists generation_log_user_idx on public.generation_log (user_id, created_at desc);


-- ---------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.styles         enable row level security;
alter table public.rooms          enable row level security;
alter table public.makeovers      enable row level security;
alter table public.generation_log enable row level security;

-- styles: anyone (even signed-out landing page) can read; nobody can write from the browser
drop policy if exists "styles: public read" on public.styles;
create policy "styles: public read" on public.styles
  for select to anon, authenticated using (true);

-- rooms: full CRUD on your own rows only
drop policy if exists "rooms: select own" on public.rooms;
drop policy if exists "rooms: insert own" on public.rooms;
drop policy if exists "rooms: update own" on public.rooms;
drop policy if exists "rooms: delete own" on public.rooms;
create policy "rooms: select own" on public.rooms
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "rooms: insert own" on public.rooms
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "rooms: update own" on public.rooms
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "rooms: delete own" on public.rooms
  for delete to authenticated using ((select auth.uid()) = user_id);

-- makeovers: browser can read, save/unsave and delete its own.
-- It can NOT insert or change status/image/palette — only the edge function can.
drop policy if exists "makeovers: select own" on public.makeovers;
drop policy if exists "makeovers: update own" on public.makeovers;
drop policy if exists "makeovers: delete own" on public.makeovers;
create policy "makeovers: select own" on public.makeovers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "makeovers: update own" on public.makeovers
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "makeovers: delete own" on public.makeovers
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Table/column privileges (belt and braces on top of RLS).
-- Explicit, so this works whether or not "Automatically expose new tables"
-- was ticked when the project was created.
revoke all on public.styles, public.rooms, public.makeovers, public.generation_log from anon, authenticated;

grant select                         on public.styles    to anon, authenticated;
grant select, insert, update, delete on public.rooms     to authenticated;
grant select, delete                 on public.makeovers to authenticated;
grant update (is_saved)              on public.makeovers to authenticated;   -- the only column the browser may change
-- generation_log: nothing for the browser

-- The edge function (service role) needs full access
grant all on public.styles, public.rooms, public.makeovers, public.generation_log to service_role;
grant usage, select on all sequences in schema public to service_role;


-- ---------------------------------------------------------------------
-- 6. FUNCTIONS
-- ---------------------------------------------------------------------

-- 6a. For the EDGE FUNCTION (service role only): atomically checks the
--     limit and records one generation. Returns true = go ahead.
create or replace function public.claim_generation(p_user_id uuid, p_daily_limit int default 15)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used int;
begin
  -- serialize per user so two fast clicks can't both slip under the limit
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select count(*) into used
  from public.generation_log
  where user_id = p_user_id and created_at > now() - interval '24 hours';

  if used >= p_daily_limit then
    return false;
  end if;

  insert into public.generation_log (user_id) values (p_user_id);
  return true;
end;
$$;

revoke all on function public.claim_generation(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_generation(uuid, int) to service_role;

-- 6b. For the FRONT END: "12 of 15 makeovers left today"
create or replace function public.my_generations_left(p_daily_limit int default 15)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(p_daily_limit - count(*)::int, 0)
  from public.generation_log
  where user_id = auth.uid() and created_at > now() - interval '24 hours';
$$;

revoke all on function public.my_generations_left(int) from public, anon;
grant execute on function public.my_generations_left(int) to authenticated;


-- ---------------------------------------------------------------------
-- 7. STORAGE  (private bucket "rooms")
--    Paths:  {user_id}/originals/{room_id}.jpg     ← browser uploads
--            {user_id}/makeovers/{makeover_id}.png ← edge function uploads
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rooms', 'rooms', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "rooms bucket: read own"   on storage.objects;
drop policy if exists "rooms bucket: upload own" on storage.objects;
drop policy if exists "rooms bucket: update own" on storage.objects;
drop policy if exists "rooms bucket: delete own" on storage.objects;

-- read (also needed to create signed URLs) — both folders
create policy "rooms bucket: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'rooms' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- upload/overwrite — originals folder only (makeovers are written by the edge function)
create policy "rooms bucket: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'rooms'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (storage.foldername(name))[2] = 'originals');

create policy "rooms bucket: update own" on storage.objects
  for update to authenticated
  using      (bucket_id = 'rooms' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'rooms'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (storage.foldername(name))[2] = 'originals');

-- delete — both folders (deleting a room or a gallery item cleans up its files)
create policy "rooms bucket: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'rooms' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- =====================================================================
-- RESET (only if you need to start over — uncomment and run alone)
-- =====================================================================
-- drop table if exists public.makeovers, public.rooms, public.generation_log, public.styles cascade;
-- drop function if exists public.claim_generation(uuid, int);
-- drop function if exists public.my_generations_left(int);
