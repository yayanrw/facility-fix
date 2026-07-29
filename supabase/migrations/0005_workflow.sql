-- Workflow transitions as database functions.
--
-- Why not do this in the Server Action? Every transition writes to two or
-- three tables at once — status + audit row, or facility + submission, or
-- status + audit + publishing a facility. supabase-js has no transactions, so
-- doing it from Node means a crash between calls can leave an orphaned
-- facility or a status change with no audit trail. One function call is one
-- transaction.
--
-- These are `security invoker`, NOT `security definer`, and EXECUTE is granted
-- only to service_role. A `security definer` function in `public` is callable
-- by anon and authenticated by default — exactly the privilege-escalation hole
-- we are trying to avoid. service_role already bypasses RLS, so definer would
-- buy nothing and cost a lot.

-- ---------------------------------------------------------------------------
-- Shared checks
-- ---------------------------------------------------------------------------

create or replace function public.assert_can_act(p_role text, p_status text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_status = 'pending_review' and p_role in ('reviewer','admin') then
    return;
  end if;
  if p_status = 'pending_approval' and p_role in ('approver','admin') then
    return;
  end if;
  raise exception 'role % may not act on a submission with status %', p_role, p_status
    using errcode = '42501';
end;
$$;

/** Strips tags and entities the same way lib/html.ts does, for the "is this
    rejection actually blank?" check. */
create or replace function public.html_is_blank(p_html text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    btrim(replace(regexp_replace(coalesce(p_html, ''), '<[^>]*>', '', 'g'), '&nbsp;', ' ')),
    ''
  ) = '';
$$;

-- ---------------------------------------------------------------------------
-- create_damage_submission
-- ---------------------------------------------------------------------------

create or replace function public.create_damage_submission(
  p_actor       uuid,
  p_facility_id bigint,
  p_title       text,
  p_description text,
  p_severity    text,
  p_deadline    date,
  p_photos      text[] default '{}'
)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_role text;
  v_id   bigint;
begin
  select role into v_role from public.profiles where id = p_actor;
  if v_role is null then
    raise exception 'unknown actor %', p_actor using errcode = '42501';
  end if;
  if v_role not in ('requester','admin') then
    raise exception 'role % may not create submissions', v_role using errcode = '42501';
  end if;

  insert into public.submissions
    (type, title, description, facility_id, severity, deadline, photos, submitted_by)
  values
    ('damage', p_title, p_description, p_facility_id, p_severity, p_deadline, p_photos, p_actor)
  returning id into v_id;

  insert into public.submission_actions (submission_id, actor_id, actor_role, action)
  values (v_id, p_actor, v_role, 'submit');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_asset_submission
--
-- Creates the facility draft and the submission together. This is the pairing
-- that must not half-succeed: a facility with no submission is invisible to
-- every screen and can never be published.
-- ---------------------------------------------------------------------------

create or replace function public.create_asset_submission(
  p_actor         uuid,
  p_title         text,
  p_description   text,
  p_deadline      date,
  p_code          text,
  p_name          text,
  p_category      text,
  p_location      text,
  p_condition     text,
  p_quantity      int,
  p_acquired_date date default null,
  p_notes         text default null,
  p_photos        text[] default '{}'
)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_role       text;
  v_facility_id bigint;
  v_id         bigint;
begin
  select role into v_role from public.profiles where id = p_actor;
  if v_role is null then
    raise exception 'unknown actor %', p_actor using errcode = '42501';
  end if;
  if v_role not in ('requester','admin') then
    raise exception 'role % may not create submissions', v_role using errcode = '42501';
  end if;

  insert into public.facilities
    (code, name, category, location, condition, quantity, acquired_date, notes,
     photos, is_active, created_by)
  values
    (p_code, p_name, p_category, p_location, p_condition, p_quantity, p_acquired_date,
     p_notes, p_photos, false, p_actor)
  returning id into v_facility_id;

  insert into public.submissions
    (type, title, description, facility_id, deadline, photos, submitted_by)
  values
    ('asset', p_title, p_description, v_facility_id, p_deadline, p_photos, p_actor)
  returning id into v_id;

  insert into public.submission_actions (submission_id, actor_id, actor_role, action)
  values (v_id, p_actor, v_role, 'submit');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- resubmit_submission
-- ---------------------------------------------------------------------------

create or replace function public.resubmit_submission(
  p_submission_id bigint,
  p_actor         uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_role   text;
  v_status text;
  v_owner  uuid;
begin
  -- Locks the row for the rest of the transaction, so two resubmits racing
  -- each other serialise instead of both writing an audit entry.
  select status, submitted_by into v_status, v_owner
  from public.submissions where id = p_submission_id for update;

  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;
  if v_owner <> p_actor then
    raise exception 'only the submitter may resubmit' using errcode = '42501';
  end if;
  if v_status <> 'rejected' then
    raise exception 'submission is %, not rejected', v_status using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_actor;

  -- Always back to pending_review, even when the approver was the one who
  -- rejected: otherwise the reviewer never sees the revised version.
  update public.submissions set status = 'pending_review' where id = p_submission_id;

  insert into public.submission_actions (submission_id, actor_id, actor_role, action)
  values (p_submission_id, p_actor, v_role, 'resubmit');
end;
$$;

-- ---------------------------------------------------------------------------
-- review_submission — the approve/reject decision for both stages
-- ---------------------------------------------------------------------------

create or replace function public.review_submission(
  p_submission_id bigint,
  p_actor         uuid,
  p_decision      text,
  p_remarks_html  text default null
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_role      text;
  v_status    text;
  v_type      text;
  v_facility  bigint;
  v_next      text;
begin
  if p_decision not in ('approve','reject') then
    raise exception 'unknown decision %', p_decision;
  end if;

  -- `for update` is what makes a double-approve safe: the second caller blocks
  -- here, then reads the already-advanced status and fails the check below
  -- instead of recording a second decision.
  select status, type, facility_id into v_status, v_type, v_facility
  from public.submissions where id = p_submission_id for update;

  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;

  select role into v_role from public.profiles where id = p_actor;
  if v_role is null then
    raise exception 'unknown actor %', p_actor using errcode = '42501';
  end if;

  perform public.assert_can_act(v_role, v_status);

  if p_decision = 'reject' and public.html_is_blank(p_remarks_html) then
    raise exception 'a rejection needs a reason' using errcode = '22023';
  end if;

  v_next := case
    when p_decision = 'reject' then 'rejected'
    when v_status = 'pending_review' then 'pending_approval'
    else 'approved'
  end;

  update public.submissions set status = v_next where id = p_submission_id;

  insert into public.submission_actions
    (submission_id, actor_id, actor_role, action, remarks_html)
  values
    (p_submission_id, p_actor, v_role, p_decision, p_remarks_html);

  -- Final approval is the moment an asset draft becomes master data.
  if v_next = 'approved' and v_type = 'asset' then
    update public.facilities set is_active = true where id = v_facility;
  end if;

  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock these down to the service role only
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.assert_can_act(text, text)',
    'public.html_is_blank(text)',
    'public.create_damage_submission(uuid, bigint, text, text, text, date, text[])',
    'public.create_asset_submission(uuid, text, text, date, text, text, text, text, text, int, date, text, text[])',
    'public.resubmit_submission(bigint, uuid)',
    'public.review_submission(bigint, uuid, text, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
