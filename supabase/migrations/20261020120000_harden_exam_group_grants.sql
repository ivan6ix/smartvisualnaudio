-- Group tables are written only by SECURITY DEFINER RPCs; clients get RLS-filtered reads.
begin;

revoke all on table public.exam_publish_groups, public.exam_publish_group_members from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.exam_publish_groups, public.exam_publish_group_members from authenticated;
grant select on table public.exam_publish_groups, public.exam_publish_group_members to authenticated;

notify pgrst, 'reload schema';
commit;
