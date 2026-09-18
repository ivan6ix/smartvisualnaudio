-- Allow users to remove only their own profile picture objects.
begin;

drop policy if exists "profile_pictures_owner_delete" on storage.objects;

create policy "profile_pictures_owner_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;
