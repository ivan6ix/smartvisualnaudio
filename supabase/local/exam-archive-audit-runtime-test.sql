delete from public.logs
where entity_id in (
  '00000000-0000-0000-0000-00000000e101',
  '00000000-0000-0000-0000-00000000e102'
)
or user_id in (
  '00000000-0000-0000-0000-00000000f101',
  '00000000-0000-0000-0000-00000000f102',
  '00000000-0000-0000-0000-00000000f103'
);

delete from public.exams
where id in (
  '00000000-0000-0000-0000-00000000e101',
  '00000000-0000-0000-0000-00000000e102'
);
delete from public.courses where id = '00000000-0000-0000-0000-00000000c101';
delete from public.profiles
where id in (
  '00000000-0000-0000-0000-00000000f101',
  '00000000-0000-0000-0000-00000000f102',
  '00000000-0000-0000-0000-00000000f103'
);
delete from auth.users
where id in (
  '00000000-0000-0000-0000-00000000f101',
  '00000000-0000-0000-0000-00000000f102',
  '00000000-0000-0000-0000-00000000f103'
);

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'archive-professor-a@example.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'archive-professor-b@example.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'archive-student@example.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.profiles (id, role, full_name, email, student_number, employee_number, status)
values
  ('00000000-0000-0000-0000-00000000f101', 'Professor', 'Archive Professor A', 'archive-professor-a@example.invalid', null, 'ARCH-A', 'Active'),
  ('00000000-0000-0000-0000-00000000f102', 'Professor', 'Archive Professor B', 'archive-professor-b@example.invalid', null, 'ARCH-B', 'Active'),
  ('00000000-0000-0000-0000-00000000f103', 'Student', 'Archive Student', 'archive-student@example.invalid', 'ARCH-S', null, 'Active')
on conflict (id) do update set
  role = excluded.role,
  full_name = excluded.full_name,
  email = excluded.email,
  student_number = excluded.student_number,
  employee_number = excluded.employee_number,
  status = excluded.status;

insert into public.courses (id, course_name, course_code, section, joining_code, professor_id)
values ('00000000-0000-0000-0000-00000000c101', 'Archive Audit Course', 'ARC101', 'A', 'ARCHIVE-AUDIT', '00000000-0000-0000-0000-00000000f101');

insert into public.exams (id, course_id, title, exam_title, description, exam_type, course, exam_settings, status, created_by, professor_id)
values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000c101', 'Own Archive Exam', 'Own Archive Exam', 'owned fixture', 'Quiz', 'Archive Audit Course', '{"archived":false}'::jsonb, 'Unpublished', '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f101'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-00000000c101', 'Other Archive Exam', 'Other Archive Exam', 'other fixture', 'Quiz', 'Archive Audit Course', '{"archived":false}'::jsonb, 'Unpublished', '00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000f102');

do $$
declare
  archived_state boolean;
  event_count integer;
  denied boolean;
  owner_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f101', true);

  perform public.set_exam_archived('00000000-0000-0000-0000-00000000e101', true);
  select (exam_settings->>'archived')::boolean into archived_state
  from public.exams
  where id = '00000000-0000-0000-0000-00000000e101';
  if archived_state is distinct from true then
    raise exception 'own archive did not set archived=true';
  end if;

  select count(*) into event_count
  from public.logs
  where entity_id = '00000000-0000-0000-0000-00000000e101'
    and event_type = 'exam.archived'
    and user_id = '00000000-0000-0000-0000-00000000f101';
  if event_count <> 1 then
    raise exception 'archive audit event count was %, expected 1', event_count;
  end if;

  perform public.set_exam_archived('00000000-0000-0000-0000-00000000e101', false);
  select (exam_settings->>'archived')::boolean into archived_state
  from public.exams
  where id = '00000000-0000-0000-0000-00000000e101';
  if archived_state is distinct from false then
    raise exception 'own restore did not set archived=false';
  end if;

  select count(*) into event_count
  from public.logs
  where entity_id = '00000000-0000-0000-0000-00000000e101'
    and event_type = 'exam.restored'
    and user_id = '00000000-0000-0000-0000-00000000f101';
  if event_count <> 1 then
    raise exception 'restore audit event count was %, expected 1', event_count;
  end if;

  reset role;
  select professor_id into owner_id
  from public.exams
  where id = '00000000-0000-0000-0000-00000000e102';
  if owner_id is distinct from '00000000-0000-0000-0000-00000000f102'::uuid then
    raise exception 'other exam owner was %, expected professor b', owner_id;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f101', true);
  denied := false;
  begin
    perform public.set_exam_archived('00000000-0000-0000-0000-00000000e102', true);
  exception when others then
    denied := true;
  end;
  if not denied then
    raise exception 'cross-professor archive unexpectedly succeeded';
  end if;

  reset role;
  select (exam_settings->>'archived')::boolean into archived_state
  from public.exams
  where id = '00000000-0000-0000-0000-00000000e102';
  if archived_state is distinct from false then
    raise exception 'cross-professor denial changed another exam';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f103', true);
  denied := false;
  begin
    perform public.set_exam_archived('00000000-0000-0000-0000-00000000e101', true);
  exception when others then
    denied := true;
  end;
  if not denied then
    raise exception 'student archive unexpectedly succeeded';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f101', true);
  denied := false;
  begin
    perform public.write_audit_log(
      '00000000-0000-0000-0000-00000000f101',
      'Professor',
      'exam.forged',
      'Forged Audit',
      'A direct authenticated audit write should fail.',
      'exam',
      '00000000-0000-0000-0000-00000000e101',
      null,
      '{}'::jsonb
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'direct authenticated write_audit_log unexpectedly succeeded';
  end if;

  reset role;
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  denied := false;
  begin
    perform public.set_exam_archived('00000000-0000-0000-0000-00000000e101', true);
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'anon archive unexpectedly succeeded';
  end if;

  reset role;

  select count(*) into event_count
  from public.logs
  where entity_id in (
    '00000000-0000-0000-0000-00000000e101',
    '00000000-0000-0000-0000-00000000e102'
  );
  if event_count <> 2 then
    raise exception 'unexpected audit rows after denial paths: %', event_count;
  end if;
end $$;

rollback;

do $$
declare
  fixture_rows integer;
begin
  select
    (select count(*) from public.logs where entity_id in (
      '00000000-0000-0000-0000-00000000e101',
      '00000000-0000-0000-0000-00000000e102'
    ))
    + (select count(*) from public.exams where id in (
      '00000000-0000-0000-0000-00000000e101',
      '00000000-0000-0000-0000-00000000e102'
    ))
    + (select count(*) from public.profiles where id in (
      '00000000-0000-0000-0000-00000000f101',
      '00000000-0000-0000-0000-00000000f102',
      '00000000-0000-0000-0000-00000000f103'
    ))
  into fixture_rows;

  if fixture_rows <> 0 then
    raise exception 'controlled fixture cleanup left % rows', fixture_rows;
  end if;
end $$;

select 'exam archive audit runtime checks passed' as result;
