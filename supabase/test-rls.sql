-- =====================================================================
-- ReRoom · RLS security test (P3)
--
-- 1. Supabase → Authentication → Users → "Add user" → create two users
--    (tick "Auto Confirm User"). Copy each user's UID.
-- 2. Paste the two UIDs below where it says USER_A / USER_B.
-- 3. Run the whole file in the SQL Editor.
--
-- Result: a single row "ALL 14 RLS CHECKS PASSED", or an error naming
-- exactly which check failed. It cleans up after itself either way.
-- =====================================================================

do $$
declare
  a      uuid := '00000000-0000-0000-0000-00000000000a';   -- ← USER_A uid
  b      uuid := '00000000-0000-0000-0000-00000000000b';   -- ← USER_B uid
  room_a uuid := gen_random_uuid();
  mk_a   uuid := gen_random_uuid();
  n      int;
begin
  -- ---------- setup (runs as admin, bypasses RLS) ----------
  insert into public.rooms (id, user_id, original_path)
    values (room_a, a, a || '/originals/' || room_a || '.jpg');
  insert into public.makeovers (id, room_id, user_id, style, status)
    values (mk_a, room_a, a, 'modern', 'done');

  -- ---------- act as USER B ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.rooms where id = room_a;
  assert n = 0, 'CHECK 1 FAILED: user B can SEE user A''s room';

  select count(*) into n from public.makeovers where id = mk_a;
  assert n = 0, 'CHECK 2 FAILED: user B can SEE user A''s makeover';

  update public.rooms set title = 'hacked' where id = room_a;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK 3 FAILED: user B can RENAME user A''s room';

  delete from public.makeovers where id = mk_a;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK 4 FAILED: user B can DELETE user A''s makeover';

  begin
    insert into public.rooms (user_id, original_path) values (a, 'x');
    raise exception 'CHECK 5 FAILED: user B can CREATE a room owned by user A';
  exception when insufficient_privilege then null;  -- expected
  end;

  -- ---------- act as USER A ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.rooms where id = room_a;
  assert n = 1, 'CHECK 6 FAILED: user A can NOT see their own room';

  update public.makeovers set is_saved = true where id = mk_a;
  get diagnostics n = row_count;
  assert n = 1, 'CHECK 7 FAILED: user A can NOT save their makeover to the gallery';

  begin
    update public.makeovers set status = 'failed' where id = mk_a;
    raise exception 'CHECK 8 FAILED: browser can change makeover STATUS (should be edge-function only)';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.makeovers (room_id, user_id, style) values (room_a, a, 'boho');
    raise exception 'CHECK 9 FAILED: browser can INSERT makeovers (should be edge-function only)';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.claim_generation(a, 15);
    raise exception 'CHECK 10 FAILED: browser can call claim_generation (would bypass the daily limit)';
  exception when insufficient_privilege then null;
  end;

  assert public.my_generations_left(15) = 15, 'CHECK 11 FAILED: my_generations_left() not working';

  select count(*) into n from public.styles;
  assert n = 4, 'CHECK 12 FAILED: expected exactly 4 styles, found ' || n;

  -- ---------- act as SIGNED-OUT visitor ----------
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  begin
    select count(*) into n from public.rooms;
    raise exception 'CHECK 13 FAILED: signed-out visitor can query rooms';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from public.styles;
  assert n = 4, 'CHECK 14 FAILED: signed-out visitor can NOT read styles (landing page needs them)';

  -- ---------- cleanup ----------
  execute 'reset role';
  delete from public.rooms where id = room_a;   -- cascades to the makeover
end;
$$;

select 'ALL 14 RLS CHECKS PASSED' as result;
