set client_min_messages = warning;

begin;

create temp table interruption_test_results (
  test text not null,
  status text not null,
  observed text not null
) on commit drop;

grant select, insert on interruption_test_results to authenticated, anon;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_anon()
returns void
language plpgsql
as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
end;
$$;

create or replace function pg_temp.as_service()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

do $$
declare
  v_professor_id uuid := '90000000-0000-0000-0000-000000000001';
  v_student_id uuid := '90000000-0000-0000-0000-000000000002';
  v_other_student_id uuid := '90000000-0000-0000-0000-000000000003';
  v_program_id uuid := '90000000-0000-0000-0000-000000000004';
  v_course_id uuid := '90000000-0000-0000-0000-000000000005';
  v_exam_id uuid := '90000000-0000-0000-0000-000000000006';
  v_question_id uuid := '90000000-0000-0000-0000-000000000007';
  v_started timestamptz;
  v_started_again timestamptz;
  v_recovery jsonb;
  v_attempt_id uuid;
  row_count integer;
begin
  perform pg_temp.as_service();

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_professor_id, 'interrupt-prof@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_student_id, 'interrupt-student@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_other_student_id, 'interrupt-other@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name, email, employee_number, student_number, status)
  values
    (v_professor_id, 'Professor', 'Interruption Professor', 'interrupt-prof@example.test', 'IP-1', null, 'Active'),
    (v_student_id, 'Student', 'Interruption Student', 'interrupt-student@example.test', null, 'IS-1', 'Active'),
    (v_other_student_id, 'Student', 'Other Interruption Student', 'interrupt-other@example.test', null, 'IS-2', 'Active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  insert into public.programs (id, program_code, program_name, is_active)
  values (v_program_id, 'INT', 'Interruption Tests', true)
  on conflict (id) do nothing;

  insert into public.courses (id, course_name, course_code, section, professor_id, program_id, joining_code, archived)
  values (v_course_id, 'Interruption Course', 'INT101', 'A', v_professor_id, v_program_id, 'INT-JOIN', false)
  on conflict (id) do update set archived = false;

  insert into public.course_enrollments (course_id, student_id)
  values (v_course_id, v_student_id)
  on conflict do nothing;

  insert into public.exams (id, course_id, title, exam_title, description, course, professor_id, time_limit, exam_type, semester, exam_settings, questions_count, duration, created_by, status, approved_at)
  values (
    v_exam_id,
    v_course_id,
    'Interruption Runtime',
    'Interruption Runtime',
    'Runtime test',
    'INT101',
    v_professor_id,
    60,
    'Quiz',
    '1st',
    '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"Unlimited Attempts","archived":false}'::jsonb,
    1,
    60,
    v_professor_id,
    'Draft',
    null
  )
  on conflict (id) do update set status = 'Draft', exam_settings = excluded.exam_settings;

  insert into public.exam_questions (id, exam_id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points)
  values (v_question_id, v_exam_id, 'Pick A', 'Multiple Choice', '["A","B"]'::jsonb, 'A', '["A"]'::jsonb, '{}'::jsonb, false, 10)
  on conflict (id) do update set correct_answer = excluded.correct_answer;

  update public.exams
  set status = 'Published', approved_at = now()
  where id = v_exam_id;

  perform pg_temp.as_user(v_student_id);

  v_started := public.authorize_exam_start(v_exam_id);
  select interruption_count into row_count from public.exam_start_sessions where exam_id = v_exam_id and student_id = v_student_id;
  insert into interruption_test_results values ('A initial start is 0/3', case when row_count = 0 then 'PASS' else 'FAIL' end, row_count::text);

  v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'recovery-1');
  insert into interruption_test_results values ('B first unique recovery is 1/3 and allowed', case when (v_recovery->>'interruption_count')::int = 1 and (v_recovery->>'resume_allowed')::boolean then 'PASS' else 'FAIL' end, v_recovery::text);

  v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'recovery-1');
  insert into interruption_test_results values ('C retry same recovery stays 1/3', case when (v_recovery->>'interruption_count')::int = 1 then 'PASS' else 'FAIL' end, v_recovery::text);

  v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'recovery-2');
  insert into interruption_test_results values ('D second unique recovery is 2/3 and allowed', case when (v_recovery->>'interruption_count')::int = 2 and (v_recovery->>'resume_allowed')::boolean then 'PASS' else 'FAIL' end, v_recovery::text);

  v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'recovery-3');
  insert into interruption_test_results values ('E third unique recovery is 3/3 and allowed', case when (v_recovery->>'interruption_count')::int = 3 and (v_recovery->>'resume_allowed')::boolean then 'PASS' else 'FAIL' end, v_recovery::text);

  v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'recovery-4');
  insert into interruption_test_results values ('F fourth unique recovery requires auto-submit', case when (v_recovery->>'interruption_count')::int = 4 and not (v_recovery->>'resume_allowed')::boolean and (v_recovery->>'should_auto_submit')::boolean then 'PASS' else 'FAIL' end, v_recovery::text);

  begin
    update public.exam_start_sessions set interruption_count = 0 where exam_id = v_exam_id and student_id = v_student_id;
    get diagnostics row_count = row_count;
    insert into interruption_test_results values ('H student cannot directly reset count', case when row_count = 0 then 'PASS' else 'FAIL' end, row_count::text || ' row(s)');
  exception when others then
    insert into interruption_test_results values ('H student cannot directly reset count', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_user(v_other_student_id);
  begin
    v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'outsider-recovery');
    insert into interruption_test_results values ('I another student cannot mutate session', 'FAIL', v_recovery::text);
  exception when others then
    insert into interruption_test_results values ('I another student cannot mutate session', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_anon();
  begin
    v_recovery := public.record_exam_interruption_recovery(v_exam_id, 'anon-recovery');
    insert into interruption_test_results values ('J anon cannot execute RPC', 'FAIL', v_recovery::text);
  exception when others then
    insert into interruption_test_results values ('J anon cannot execute RPC', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_user(v_student_id);
  v_attempt_id := public.submit_exam_attempt(v_exam_id, jsonb_build_object(v_question_id::text, 'A'), '[]'::jsonb);
  insert into interruption_test_results values ('M submit remains idempotent after interruption limit', case when public.submit_exam_attempt(v_exam_id, jsonb_build_object(v_question_id::text, 'A'), '[]'::jsonb) = v_attempt_id then 'PASS' else 'FAIL' end, coalesce(v_attempt_id::text, '<null>'));

  v_started_again := public.authorize_exam_start(v_exam_id);
  select interruption_count into row_count from public.exam_start_sessions where exam_id = v_exam_id and student_id = v_student_id;
  insert into interruption_test_results values ('G new legitimate attempt starts at 0/3', case when row_count = 0 and v_started_again > v_started then 'PASS' else 'FAIL' end, row_count::text);

  insert into interruption_test_results values ('K authenticated intended caller can execute RPC', case when public.record_exam_interruption_recovery(v_exam_id, 'new-attempt-recovery') is not null then 'PASS' else 'FAIL' end, 'executed');
  insert into interruption_test_results values ('N violations remain separate from interruption count', case when (select count(*) from public.violations where exam_id = v_exam_id and student_id = v_student_id) = 0 then 'PASS' else 'FAIL' end, 'violation rows: ' || (select count(*) from public.violations where exam_id = v_exam_id and student_id = v_student_id)::text);
end $$;

select * from interruption_test_results order by test;

rollback;
