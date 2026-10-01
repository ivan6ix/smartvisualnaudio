delete from public.violations
where id in (
  '00000000-0000-0000-0000-00000000d001',
  '00000000-0000-0000-0000-00000000d002',
  '00000000-0000-0000-0000-00000000d003'
);
delete from public.exams where id = '00000000-0000-0000-0000-00000000c001';
delete from public.courses where id = '00000000-0000-0000-0000-00000000b001';
delete from public.profiles
where id in (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000a002',
  '00000000-0000-0000-0000-00000000a003'
);
delete from auth.users
where id in (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000a002',
  '00000000-0000-0000-0000-00000000a003'
);

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'policy-student-a@example.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'policy-student-b@example.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'policy-professor@example.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.profiles (id, role, full_name, email, student_number, employee_number, status)
values
  ('00000000-0000-0000-0000-00000000a001', 'Student', 'Policy Student A', 'policy-student-a@example.invalid', 'POL-A', null, 'Active'),
  ('00000000-0000-0000-0000-00000000a002', 'Student', 'Policy Student B', 'policy-student-b@example.invalid', 'POL-B', null, 'Active'),
  ('00000000-0000-0000-0000-00000000a003', 'Professor', 'Policy Professor', 'policy-professor@example.invalid', null, 'POL-P', 'Active')
on conflict (id) do update set
  role = excluded.role,
  full_name = excluded.full_name,
  email = excluded.email,
  student_number = excluded.student_number,
  employee_number = excluded.employee_number,
  status = excluded.status;

insert into public.courses (id, course_name, course_code, section, joining_code, professor_id)
values ('00000000-0000-0000-0000-00000000b001', 'Policy Course', 'POL101', 'A', 'POLICY-TEST', '00000000-0000-0000-0000-00000000a003');

insert into public.exams (id, course_id, title, exam_title, created_by, professor_id, status, exam_settings)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'Policy Exam', 'Policy Exam', '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a003', 'Published', '{"liveCameraMonitoring":true,"captureSnapshots":true}'::jsonb);

insert into public.violations (id, student_id, exam_id, course_id, professor_id, violation_type, severity, description, screenshot_url)
values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a003', 'MULTIPLE_FACE', 'High', 'owned null screenshot', null),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a003', 'NO_FACE', 'High', 'owned existing screenshot', '00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000c001/existing.jpg'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a003', 'PHONE_DETECTED', 'High', 'other student violation', null);

set local role authenticated;

do $$
declare
  changed_count integer;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);

  update public.violations
  set screenshot_url = '00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000c001/first.jpg'
  where id = '00000000-0000-0000-0000-00000000d001';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'own first screenshot attachment failed';
  end if;

  update public.violations
  set screenshot_url = '00000000-0000-0000-0000-00000000a002/00000000-0000-0000-0000-00000000c001/cross.jpg'
  where id = '00000000-0000-0000-0000-00000000d003';
  get diagnostics changed_count = row_count;
  if changed_count <> 0 then
    raise exception 'cross-student update unexpectedly succeeded';
  end if;

  begin
    update public.violations
    set screenshot_url = 'replacement.jpg'
    where id = '00000000-0000-0000-0000-00000000d002';
    raise exception 'screenshot replacement unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'screenshot replacement unexpectedly succeeded' then
      raise;
    end if;
  end;

  begin
    update public.violations
    set screenshot_url = 'tamper.jpg', violation_type = 'LOOKING_AWAY'
    where id = '00000000-0000-0000-0000-00000000d001';
    raise exception 'trusted field tampering unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'trusted field tampering unexpectedly succeeded' then
      raise;
    end if;
  end;
end $$;

rollback;

select 'violation evidence policy runtime checks passed' as result;
