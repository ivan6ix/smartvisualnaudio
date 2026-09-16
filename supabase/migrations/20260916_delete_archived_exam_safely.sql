-- Permanent deletion is only allowed for archived professor-owned exams that
-- have no student, integrity, or approval history. Questions and draft-only
-- exam content are removed by existing foreign-key cascades from exams.
begin;

create or replace function public.delete_archived_exam(p_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  target_exam public.exams;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'Professor'
      and status = 'Active'
  ) then
    raise exception 'Professor access required.';
  end if;

  select *
  into target_exam
  from public.exams
  where id = p_id
    and (professor_id = auth.uid() or created_by = auth.uid())
    and coalesce((exam_settings->>'archived')::boolean, false) = true
  for update;

  if target_exam.id is null then
    raise exception 'Archived exam not found or access denied.';
  end if;

  if exists(select 1 from public.exam_start_sessions where exam_id = p_id)
     or exists(select 1 from public.exam_attempts where exam_id = p_id)
     or exists(select 1 from public.violations where exam_id = p_id)
     or exists(select 1 from public.exam_reviews where exam_id = p_id)
     or exists(select 1 from public.exam_approval_logs where exam_id = p_id)
     or exists(select 1 from public.exam_rejection_logs where exam_id = p_id) then
    raise exception 'This archived exam has student, integrity, or approval history and cannot be permanently deleted.';
  end if;

  delete from public.exams
  where id = p_id
    and (professor_id = auth.uid() or created_by = auth.uid())
    and coalesce((exam_settings->>'archived')::boolean, false) = true;

  if not found then
    raise exception 'Archived exam was not deleted.';
  end if;
end $$;

revoke all on function public.delete_archived_exam(uuid) from public;
grant execute on function public.delete_archived_exam(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
