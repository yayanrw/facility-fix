-- Facility Fix — photo storage
--
-- Private bucket. Damage photos can reveal internal layout and access points,
-- so nothing here is world-readable; the app hands out short-lived signed URLs
-- generated server-side.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facility-photos',
  'facility-photos',
  false,
  10485760, -- 10 MB
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do nothing;

-- Objects live under `{auth.uid()}/{uuid}.{ext}`.
--
-- Keying the folder by uploader rather than by submission is what makes these
-- policies expressible at all: the upload happens while the user is still
-- filling in the form, before any submission row exists, so there is no
-- submission id to key on yet.
create policy facility_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facility-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Clients only ever read back their own uploads (the preview in the form).
-- Reviewers and approvers see photos through signed URLs minted by the server
-- with the service role, which bypasses RLS.
create policy facility_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'facility-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Removing a photo you just attached, before submitting.
create policy facility_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'facility-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
