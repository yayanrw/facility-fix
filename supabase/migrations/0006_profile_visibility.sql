-- Widen profile visibility just far enough for the timeline to render names.
--
-- The original policy allowed self + admin only, which broke two real screens:
-- a reviewer could not see who submitted, and a requester could not see who
-- rejected their own submission ("Ditolak oleh —").
--
-- The fix is deliberately not "any authenticated user may read every profile",
-- which would hand every employee a full staff directory with email addresses.
-- Instead: staff see everyone (they work the queue), and a requester sees the
-- people who have actually acted on their own submissions.

create index if not exists submission_actions_actor_idx
  on public.submission_actions (actor_id);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.auth_role()) in ('reviewer','approver','admin')
    or exists (
      select 1
      from public.submission_actions a
      join public.submissions s on s.id = a.submission_id
      where a.actor_id = profiles.id
        and s.submitted_by = (select auth.uid())
    )
  );
