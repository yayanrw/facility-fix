-- Facility Fix — core schema
-- See docs/01-data-model.md for the reasoning behind each table.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — application data for auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  email      text not null,
  role       text not null default 'requester'
             check (role in ('requester','reviewer','approver','admin')),
  unit       text,
  created_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

-- Every auth user gets a profile. Without this, a freshly signed-up user would
-- have a session but no role, and every policy would deny them silently.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Role is deliberately NOT read from raw_user_meta_data. That field is
  -- attacker-controlled: `supabase.auth.signUp({ options: { data: { role:
  -- 'admin' } } })` is a plain client call. Everyone starts as a requester;
  -- promotion happens through an admin using the service role.
  insert into public.profiles (id, name, email, role, unit)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    new.email,
    'requester',
    nullif(new.raw_user_meta_data->>'unit', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- facilities — master sarana fasilitas
-- ---------------------------------------------------------------------------

create table public.facilities (
  id            bigint primary key generated always as identity,
  code          text not null unique,
  name          text not null,
  category      text not null,
  location      text not null,
  condition     text not null check (condition in ('baik','rusak_ringan','rusak_berat')),
  quantity      int  not null default 1 check (quantity > 0),
  acquired_date date,
  notes         text,
  photos        text[] not null default '{}',
  is_active     boolean not null default false,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index facilities_active_category_idx on public.facilities (is_active, category);
create index facilities_location_idx on public.facilities (location);
create index facilities_created_by_idx on public.facilities (created_by);

create trigger facilities_touch_updated_at
  before update on public.facilities
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- submissions — one table for both kinds of request
-- ---------------------------------------------------------------------------

create table public.submissions (
  id               bigint primary key generated always as identity,
  type             text not null check (type in ('damage','asset')),
  title            text not null,
  description      text not null,
  facility_id      bigint not null references public.facilities(id),
  severity         text check (severity in ('ringan','sedang','berat')),
  deadline         date not null,
  status           text not null default 'pending_review'
                   check (status in ('pending_review','pending_approval','approved','rejected')),
  photos           text[] not null default '{}',
  submitted_by     uuid not null references public.profiles(id),
  reminder_sent_at timestamptz,
  overdue_sent_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Severity describes damage. An asset registration has nothing to rate.
  constraint severity_only_for_damage
    check (type <> 'asset' or severity is null),
  constraint severity_required_for_damage
    check (type <> 'damage' or severity is not null)
);

-- Serves both the daily cron query and the list filters.
create index submissions_status_deadline_idx on public.submissions (status, deadline);
create index submissions_submitted_by_idx on public.submissions (submitted_by);
create index submissions_facility_idx on public.submissions (facility_id);

create trigger submissions_touch_updated_at
  before update on public.submissions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Immutability guards
--
-- These live in triggers rather than RLS `with check` clauses on purpose: a
-- policy that compares NEW against the current row needs a subquery on the
-- same table, which re-enters RLS and risks recursion. A trigger sees OLD and
-- NEW directly and applies to service-role writes too.
-- ---------------------------------------------------------------------------

create or replace function public.guard_submission_immutables()
returns trigger
language plpgsql
as $$
begin
  -- Deadline is set once, at submit. Resetting it on revision would turn a
  -- rejection into a way to buy another week (docs/02-workflow.md).
  if new.deadline is distinct from old.deadline then
    raise exception 'deadline is immutable after submit';
  end if;
  if new.type is distinct from old.type then
    raise exception 'submission type is immutable';
  end if;
  if new.submitted_by is distinct from old.submitted_by then
    raise exception 'submitted_by is immutable';
  end if;
  if new.facility_id is distinct from old.facility_id then
    raise exception 'facility_id is immutable';
  end if;
  return new;
end;
$$;

create trigger submissions_guard_immutables
  before update on public.submissions
  for each row execute function public.guard_submission_immutables();

-- A damage report must point at a published facility; an asset registration
-- must point at the submitter's own unpublished draft. Enforced here so it
-- holds no matter which client or key performs the insert.
create or replace function public.guard_submission_facility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  select is_active, created_by into f from public.facilities where id = new.facility_id;
  if not found then
    raise exception 'facility % not found', new.facility_id;
  end if;

  if new.type = 'damage' and not f.is_active then
    raise exception 'damage report must reference a published facility';
  end if;

  if new.type = 'asset' then
    if f.is_active then
      raise exception 'asset submission must reference an unpublished facility';
    end if;
    if f.created_by is distinct from new.submitted_by then
      raise exception 'asset submission must reference the submitter''s own facility draft';
    end if;
  end if;

  return new;
end;
$$;

create trigger submissions_guard_facility
  before insert on public.submissions
  for each row execute function public.guard_submission_facility();

-- ---------------------------------------------------------------------------
-- submission_actions — audit trail and remarks
-- ---------------------------------------------------------------------------

create table public.submission_actions (
  id            bigint primary key generated always as identity,
  -- `restrict`, not `cascade`: the append-only trigger below would abort a
  -- cascading delete anyway. Restrict states the real rule — a submission with
  -- history cannot be deleted.
  submission_id bigint not null references public.submissions(id) on delete restrict,
  actor_id      uuid not null references public.profiles(id),
  -- Snapshot, not a lookup: if the actor's role changes later, this still
  -- shows the capacity they acted in.
  actor_role    text not null check (actor_role in ('requester','reviewer','approver','admin')),
  action        text not null check (action in ('submit','resubmit','approve','reject')),
  remarks_html  text,
  created_at    timestamptz not null default now(),

  -- A rejection without a reason is the one thing this whole flow exists to
  -- prevent. Length check catches an empty contenteditable ("<p><br></p>").
  constraint reject_requires_remarks
    check (action <> 'reject' or coalesce(length(regexp_replace(remarks_html, '<[^>]*>', '', 'g')), 0) > 0)
);

create index submission_actions_submission_idx
  on public.submission_actions (submission_id, created_at);

-- The audit trail is append-only for everyone, service role included.
create or replace function public.forbid_action_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'submission_actions is append-only';
end;
$$;

create trigger submission_actions_append_only
  before update or delete on public.submission_actions
  for each row execute function public.forbid_action_mutation();
