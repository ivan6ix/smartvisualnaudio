-- A rejected shared exam can be resubmitted for Cluster review without an edit,
-- matching the single-course workflow. Every other lifecycle rule is unchanged.
begin;

create or replace function public.transition_exam_group(
  p_group_id uuid, p_action text, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_group public.exam_publish_groups;
  v_member record;
  v_status text;
  v_archived boolean;
  v_first jsonb;
  v_count integer := 0;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'Professor' and p.status = 'Active') then
    raise exception 'Active Professor access required.';
  end if;
  select * into v_group from public.exam_publish_groups
  where id = p_group_id and created_by = auth.uid() for update;
  if not found then raise exception 'Group access denied.'; end if;
  if v_group.revision <> p_expected_revision then
    raise exception 'Shared exam changed since it was opened.' using errcode = '40001';
  end if;
  for v_member in
    select e.*, m.course_id as member_course_id from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = p_group_id order by e.id for update of e
  loop
    v_count := v_count + 1;
    if v_member.professor_id <> auth.uid() or v_member.course_id <> v_member.member_course_id then
      raise exception 'Group member ownership or course diverged.';
    end if;
    if p_action in ('publish', 'submit_review') and not exists (
      select 1 from public.courses c where c.id = v_member.course_id
        and c.professor_id = auth.uid() and not c.archived
    ) then
      raise exception 'Every destination course must remain active and assigned.';
    end if;
    if v_first is null then
      v_first := public.exam_group_shared_content(v_member.id);
      v_status := v_member.status;
      v_archived := coalesce((v_member.exam_settings->>'archived')::boolean, false);
    elsif public.exam_group_shared_content(v_member.id) <> v_first
       or v_member.status <> v_status
       or coalesce((v_member.exam_settings->>'archived')::boolean, false) <> v_archived then
      raise exception 'Group members diverged; no changes were applied.';
    end if;
  end loop;
  if v_count = 0 then raise exception 'Group has no members.'; end if;
  if (p_action = 'publish' and (v_archived or v_status <> 'Unpublished'))
     or (p_action = 'unpublish' and v_status <> 'Published')
     or (p_action = 'submit_review' and (v_archived or v_status not in ('Unpublished', 'Rejected')))
     or (p_action = 'move_to_unpublished' and v_status <> 'Draft')
     or (p_action = 'archive' and v_archived)
     or (p_action = 'restore' and not v_archived)
     or p_action not in ('publish','unpublish','submit_review','move_to_unpublished','archive','restore') then
    raise exception 'Invalid group lifecycle transition.';
  end if;
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id)
  values (txid_current(), pg_backend_pid(), p_group_id);
  for v_member in
    select e.*, m.course_id as member_course_id from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = p_group_id order by e.id
  loop
    if p_action = 'publish' then
      if v_member.submitted_at is not null and v_member.approved_at is null then
        raise exception 'Cluster review approval is required before publishing.';
      end if;
      perform public.publish_exam(v_member.id);
    elsif p_action = 'unpublish' then
      update public.exams set status = 'Unpublished' where id = v_member.id;
    elsif p_action = 'submit_review' then
      update public.exams set status = 'Pending Review', submitted_at = now(),
        approved_at = null, rejected_at = null where id = v_member.id;
    elsif p_action = 'move_to_unpublished' then
      update public.exams set status = 'Unpublished' where id = v_member.id;
    elsif p_action in ('archive','restore') then
      perform public.set_exam_archived(v_member.id, p_action = 'archive');
    end if;
  end loop;
  delete from exam_private.group_write_context
  where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = p_group_id;
  update public.exam_publish_groups set revision = revision + 1, updated_at = now()
  where id = p_group_id;
  return public.get_exam_group((select m.exam_id from public.exam_publish_group_members m
    where m.group_id = p_group_id order by m.course_id limit 1));
end;
$$;
revoke all on function public.transition_exam_group(uuid,text,bigint) from public, anon;
grant execute on function public.transition_exam_group(uuid,text,bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
