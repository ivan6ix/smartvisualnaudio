begin;

create or replace function public.set_exam_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  exam_row public.exams;
  actor_id uuid := (select auth.uid());
  actor_role text;
begin
  if actor_id is null then
    raise exception 'Professor access required.';
  end if;

  if p_archived is null then
    raise exception 'Archive state is required.';
  end if;

  select role::text
  into actor_role
  from public.profiles
  where id = actor_id
    and role = 'Professor';

  if actor_role is null then
    raise exception 'Professor access required.';
  end if;

  update public.exams
  set exam_settings = jsonb_set(exam_settings, '{archived}', to_jsonb(p_archived))
  where id = p_id
    and (professor_id = actor_id or created_by = actor_id)
  returning * into exam_row;

  if exam_row.id is null then
    raise exception 'Exam access denied.';
  end if;

  perform public.write_audit_log(
    actor_id, actor_role,
    case when p_archived then 'exam.archived' else 'exam.restored' end,
    case when p_archived then 'Exam Archived' else 'Exam Restored' end,
    case when p_archived then 'A professor archived an exam.' else 'A professor restored an exam.' end,
    'exam', exam_row.id, null,
    jsonb_build_object('course_id', exam_row.course_id, 'status', exam_row.status)
  );
end;
$$;

revoke all on function public.set_exam_archived(uuid, boolean) from public, anon;
grant execute on function public.set_exam_archived(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
