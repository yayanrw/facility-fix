-- Fixes reported by `supabase db advisors`.
--
-- Two classes:
--   1. auth_rls_initplan (PERFORMANCE) — `auth.uid()` and `auth_role()` were
--      being re-evaluated once per row. Wrapping them in `(select …)` makes
--      Postgres treat them as an InitPlan: evaluated once per statement.
--   2. function_search_path_mutable (SECURITY) — three trigger functions had a
--      caller-controlled search_path.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on the remaining trigger functions
--
-- These are not `security definer`, so the risk is lower than for auth_role(),
-- but a caller can still point `public` at their own schema and change which
-- objects the function body resolves to.
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_submission_immutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
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

create or replace function public.forbid_action_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'submission_actions is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Hoist auth.uid() / auth_role() out of the per-row loop
--
-- Semantics are unchanged throughout — only the evaluation count differs.
-- ---------------------------------------------------------------------------

-- profiles ------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.auth_role()) = 'admin'
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.auth_role())
  );

-- facilities ----------------------------------------------------------------

drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities
  for select to authenticated
  using (
    is_active
    or created_by = (select auth.uid())
    or (select public.auth_role()) in ('reviewer','approver','admin')
  );

drop policy if exists facilities_insert on public.facilities;
create policy facilities_insert on public.facilities
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.auth_role()) in ('requester','admin')
    and not is_active
  );

drop policy if exists facilities_update_owner on public.facilities;
create policy facilities_update_owner on public.facilities
  for update to authenticated
  using (
    created_by = (select auth.uid())
    and not is_active
    and public.facility_is_revisable(id)
  )
  with check (
    created_by = (select auth.uid())
    and not is_active
  );

-- submissions ---------------------------------------------------------------

drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select to authenticated
  using (
    submitted_by = (select auth.uid())
    or (select public.auth_role()) in ('reviewer','approver','admin')
  );

drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and (select public.auth_role()) in ('requester','admin')
    and status = 'pending_review'
    and deadline >= current_date
  );

drop policy if exists submissions_update_owner on public.submissions;
create policy submissions_update_owner on public.submissions
  for update to authenticated
  using (submitted_by = (select auth.uid()) and status = 'rejected')
  with check (submitted_by = (select auth.uid()) and status = 'rejected');

-- submission_actions --------------------------------------------------------

drop policy if exists submission_actions_select on public.submission_actions;
create policy submission_actions_select on public.submission_actions
  for select to authenticated
  using (
    exists (
      select 1 from public.submissions s
      where s.id = submission_actions.submission_id
        and (
          s.submitted_by = (select auth.uid())
          or (select public.auth_role()) in ('reviewer','approver','admin')
        )
    )
  );
