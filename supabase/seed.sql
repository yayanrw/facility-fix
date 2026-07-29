-- Facility Fix — demo seed
--
-- Replaces the ad-hoc data left over from step 5–6 browser verification with
-- one requester, one reviewer, one approver, one admin, ~9 published
-- facilities, and a submission sitting in every status. Safe to re-run: it
-- deletes its own rows first, by fixed UUID, so the result is the same
-- every time.
--
-- Run with the same direct connection used for migrations (see CLAUDE.md):
--   psql "$DBURL" -f supabase/seed.sql
--
-- Requires pgcrypto for crypt() — already enabled by Supabase's auth schema.

begin;

-- ---------------------------------------------------------------------------
-- Clean slate: remove anything this script (or step 5–6's manual browser
-- verification) previously created, so a re-run always lands on the same
-- state.
--
-- ON DELETE CASCADE is itself implemented as a trigger, so profiles rows are
-- deleted explicitly here rather than left to cascade from auth.users —
-- session_replication_role = replica (needed below to get past the
-- append-only guard on submission_actions, the same reason
-- test/integration/db.ts's purgeUsers uses it) suppresses cascade triggers
-- too, and an orphaned profiles row would otherwise survive with a stale id.
-- ---------------------------------------------------------------------------

set session_replication_role = replica;

do $$
declare
  seed_users  uuid[] := array[
    'eeeeeeee-1111-4111-8111-eeeeeeeeeeee', -- requester
    'eeeeeeee-2222-4222-8222-eeeeeeeeeeee', -- reviewer
    'eeeeeeee-3333-4333-8333-eeeeeeeeeeee', -- approver
    'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'  -- admin
  ];
  stale_users uuid[];
begin
  select array_agg(id) into stale_users
  from public.profiles
  where id = any(seed_users)
     or email in ('req@ff.test', 'rev@ff.test', 'app@ff.test', 'admin@ff.test');

  if stale_users is not null then
    delete from public.submission_actions
    where submission_id in (select id from public.submissions where submitted_by = any(stale_users))
       or actor_id = any(stale_users);
    delete from public.submissions where submitted_by = any(stale_users);
    delete from public.facilities where created_by = any(stale_users);
    delete from public.profiles where id = any(stale_users);
    delete from auth.identities where user_id = any(stale_users);
    delete from auth.users where id = any(stale_users);
  end if;
end $$;

set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Users — one per role, password `FlowTest!2026` for all four.
-- ---------------------------------------------------------------------------

-- The *_token/*_change columns default to NULL, but GoTrue's schema query
-- scans them as plain (non-nullable) Go strings — a NULL there fails with a
-- generic "Database error querying schema" 500, not a useful message. The
-- Admin API always writes '' for these; this insert has to match by hand.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
   'authenticated', 'authenticated', 'req@ff.test', crypt('FlowTest!2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Rina Pelapor","unit":"Gedung 1"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee',
   'authenticated', 'authenticated', 'rev@ff.test', crypt('FlowTest!2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Siti Reviewer"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee',
   'authenticated', 'authenticated', 'app@ff.test', crypt('FlowTest!2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Budi Approver"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee',
   'authenticated', 'authenticated', 'admin@ff.test', crypt('FlowTest!2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Dedi Admin"}', now(), now(),
   '', '', '', '', '', '', '', '');

-- GoTrue looks up the email/password identity here, not just auth.users —
-- without a row per user, password login 500s with "Database error querying
-- schema" instead of a clean 401.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', false, 'phone_verified', false),
  'email', now(), now(), now()
from auth.users u
where u.id in (
  'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
  'eeeeeeee-2222-4222-8222-eeeeeeeeeeee',
  'eeeeeeee-3333-4333-8333-eeeeeeeeeeee',
  'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'
);

-- The signup trigger already created a profile per user (role defaults to
-- requester); fix up the three that need a different role.
update public.profiles set role = 'reviewer' where id = 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee';
update public.profiles set role = 'approver' where id = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
update public.profiles set role = 'admin'    where id = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee';

-- ---------------------------------------------------------------------------
-- Facilities — published master data, owned by the admin account.
-- ---------------------------------------------------------------------------

insert into public.facilities (code, name, category, location, condition, quantity, is_active, created_by)
values
  ('AC-GD1-101-U1',  'AC Ruang 101',        'AC',         'Gedung 1 / Ruang 101',      'baik',         1,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('AC-GD1-201-U1',  'AC Ruang 201',        'AC',         'Gedung 1 / Ruang 201',      'baik',         1,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('AC-GD3-301-U2',  'AC Ruang 301',        'AC',         'Gedung 3 / Ruang 301',      'rusak_berat',  1,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('AC-GD4-LAB-01',  'AC Lab Komputer',     'AC',         'Gedung 4 / Lab Komputer',   'rusak_ringan', 1,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('PRJ-GD2-AULA-01','Proyektor Aula',      'Elektronik', 'Gedung 2 / Aula',           'rusak_ringan', 1,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('PRN-GD1-TU-01',  'Printer Tata Usaha',  'Elektronik', 'Gedung 1 / Tata Usaha',     'baik',         1,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('KOM-GD4-LAB-20', 'Komputer Lab',        'Elektronik', 'Gedung 4 / Lab Komputer',   'baik',         20, true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('KRS-GD2-AULA-50','Kursi Aula',          'Meubel',     'Gedung 2 / Aula',           'baik',         50, true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  ('LEM-GD3-ARSIP-02','Lemari Arsip',       'Meubel',     'Gedung 3 / Ruang Arsip',    'baik',         2,  true, 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee');

-- ---------------------------------------------------------------------------
-- Submissions — one in each status, through the same RPCs the app calls.
-- ---------------------------------------------------------------------------

do $$
declare
  requester uuid := 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
  reviewer  uuid := 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee';
  approver  uuid := 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
  v_id      bigint;
begin
  -- pending_review (damage): freshly submitted, nobody has acted yet.
  perform public.create_damage_submission(
    requester,
    (select id from public.facilities where code = 'AC-GD1-101-U1'),
    'AC mati total', 'AC tidak menyala sejak kemarin, sudah dicek MCB normal.',
    'berat', current_date + 3
  );

  -- pending_review (asset): a facility draft awaiting its first review.
  perform public.create_asset_submission(
    requester,
    'Pendataan Proyektor Ruang Rapat', 'Proyektor baru dari pengadaan Q3.', current_date + 7,
    'PRJ-GD2-RAPAT-01', 'Proyektor Ruang Rapat', 'Elektronik', 'Gedung 2 / Ruang Rapat', 'baik', 1
  );

  -- pending_approval (damage): reviewer already approved, waiting on the approver.
  v_id := public.create_damage_submission(
    requester,
    (select id from public.facilities where code = 'AC-GD3-301-U2'),
    'AC bergetar dan berisik', 'Getaran keras terdengar sejak pagi, mengganggu ruang sebelah.',
    'sedang', current_date + 2
  );
  perform public.review_submission(v_id, reviewer, 'approve', null);

  -- rejected (damage): reviewer sent it back with a reason.
  v_id := public.create_damage_submission(
    requester,
    (select id from public.facilities where code = 'KRS-GD2-AULA-50'),
    'Kursi rapuh', 'Beberapa kursi terasa goyah saat diduduki.',
    'ringan', current_date + 5
  );
  perform public.review_submission(
    v_id, reviewer, 'reject',
    '<p>Foto belum jelas, mohon lampirkan foto kondisi kursi yang rapuh.</p>'
  );

  -- approved (asset): both stages signed off, publishing a new facility.
  v_id := public.create_asset_submission(
    requester,
    'Pendataan Laptop Inventaris Baru', 'Laptop baru dari pengadaan Q3.', current_date + 7,
    'LPT-GD1-TU-05', 'Laptop Tata Usaha', 'Elektronik', 'Gedung 1 / Tata Usaha', 'baik', 5
  );
  perform public.review_submission(v_id, reviewer, 'approve', null);
  perform public.review_submission(v_id, approver, 'approve', null);
end $$;

commit;
