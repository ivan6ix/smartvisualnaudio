set client_min_messages = warning;

begin;

create temp table security_matrix_results (
  area text not null,
  test text not null,
  status text not null,
  observed text not null
) on commit drop;

grant select, insert on security_matrix_results to authenticated;

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
  v_admin_id uuid := '00000000-0000-0000-0000-000000000001';
  v_professor_id uuid := '00000000-0000-0000-0000-000000000002';
  v_cluster_id uuid := '00000000-0000-0000-0000-000000000003';
  v_student_id uuid := '00000000-0000-0000-0000-000000000004';
  v_dean_id uuid := '00000000-0000-0000-0000-000000000005';
  v_outsider_id uuid := '00000000-0000-0000-0000-000000000006';
  v_program_id uuid := '10000000-0000-0000-0000-000000000001';
  v_course_id uuid := '20000000-0000-0000-0000-000000000001';
  v_private_course_id uuid := '20000000-0000-0000-0000-000000000002';
  v_exam_id uuid := '30000000-0000-0000-0000-000000000001';
  v_draft_exam_id uuid := '30000000-0000-0000-0000-000000000002';
  v_question_id uuid := '40000000-0000-0000-0000-000000000001';
  v_attempt_id uuid;
  v_duplicate_attempt_id uuid;
  v_notification_id uuid;
  row_count integer;
  raw_value text;
begin
  perform pg_temp.as_service();

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_admin_id, 'admin.local@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_professor_id, 'prof.local@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_cluster_id, 'cluster.local@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_student_id, 'student.local@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_dean_id, 'dean.local@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_outsider_id, 'outsider.local@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name, email, employee_number, student_number, status)
  values
    (v_admin_id, 'Admin', 'Local Admin', 'admin.local@example.test', 'A-1', null, 'Active'),
    (v_professor_id, 'Professor', 'Local Professor', 'prof.local@example.test', 'P-1', null, 'Active'),
    (v_cluster_id, 'Cluster Professor', 'Local Cluster', 'cluster.local@example.test', 'C-1', null, 'Active'),
    (v_student_id, 'Student', 'Local Student', 'student.local@example.test', null, 'S-1', 'Active'),
    (v_dean_id, 'Dean', 'Local Dean', 'dean.local@example.test', 'D-1', null, 'Active'),
    (v_outsider_id, 'Student', 'Local Outsider', 'outsider.local@example.test', null, 'S-2', 'Active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  insert into public.programs (id, program_code, program_name, is_active)
  values (v_program_id, 'LCS', 'Local Computer Studies', true)
  on conflict (id) do nothing;

  insert into public.courses (id, course_name, course_code, program_id, year_level, section, semester, academic_year, joining_code, professor_id, archived)
  values
    (v_course_id, 'Local Security Course', 'SEC101', v_program_id, '1', 'A', '1st', '2026-2027', 'JOINSEC', v_professor_id, false),
    (v_private_course_id, 'Private Course', 'SEC999', v_program_id, '1', 'B', '1st', '2026-2027', 'PRIVATE1', v_professor_id, false)
  on conflict (id) do nothing;

  insert into public.course_enrollments (course_id, student_id)
  values (v_course_id, v_student_id)
  on conflict (course_id, student_id) do nothing;

  insert into public.exams (id, course_id, title, exam_title, description, course, professor_id, time_limit, exam_type, semester, exam_settings, questions_count, duration, created_by, status, approved_at)
  values
    (v_exam_id, v_course_id, 'Security Midterm', 'Security Midterm', 'Runtime test', 'SEC101', v_professor_id, 60, 'Quiz', '1st',
      '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 Attempt","archived":false}'::jsonb,
      1, 60, v_professor_id, 'Pending Review', null),
    (v_draft_exam_id, v_course_id, 'Pending Exam', 'Pending Exam', 'Runtime pending review', 'SEC101', v_professor_id, 60, 'Quiz', '1st',
      '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"Unlimited Attempts","archived":false}'::jsonb,
      0, 60, v_professor_id, 'Pending Review', null)
  on conflict (id) do update set status = excluded.status, exam_settings = excluded.exam_settings;

  insert into public.exam_questions (id, exam_id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points)
  values (
    v_question_id,
    v_exam_id,
    'Pick A',
    'Multiple Choice',
    '["A","B","C"]'::jsonb,
    'A',
    '["A"]'::jsonb,
    '{"correctAnswer":"A","answerKey":"A","shuffle":true}'::jsonb,
    false,
    10
  )
  on conflict (id) do nothing;

  update public.exams
  set status = 'Published', approved_at = now()
  where id = v_exam_id;

  perform pg_temp.as_user(v_student_id);
  select count(*) into row_count from public.get_student_exam_questions(v_exam_id);
  insert into security_matrix_results values ('ANSWER KEY SECURITY', 'Student can retrieve sanitized exam questions', case when row_count = 1 then 'PASS' else 'FAIL' end, row_count::text || ' row(s)');

  select correct_answer into raw_value from public.exam_questions where id = v_question_id;
  insert into security_matrix_results values ('ANSWER KEY SECURITY', 'Student cannot retrieve correct_answer via table read', case when raw_value is null then 'PASS' else 'FAIL' end, coalesce(raw_value, '<not visible>'));

  select question_config::text into raw_value from public.get_student_exam_questions(v_exam_id) where id = v_question_id;
  insert into security_matrix_results values ('ANSWER KEY SECURITY', 'Student receives answer-bearing question_config sanitized', case when raw_value not like '%answerKey%' and raw_value not like '%correctAnswer%' then 'PASS' else 'FAIL' end, raw_value);

  begin
    insert into public.exam_attempts (exam_id, student_id, score, earned_points, max_points, status)
    values (v_exam_id, v_student_id, 100, 10, 10, 'Submitted');
    insert into security_matrix_results values ('ATTEMPT SECURITY', 'Student cannot directly forge score/points', 'FAIL', 'direct insert succeeded');
  exception when others then
    insert into security_matrix_results values ('ATTEMPT SECURITY', 'Student cannot directly forge score/points', 'PASS', sqlerrm);
  end;

  perform public.authorize_exam_start(v_exam_id);
  v_attempt_id := public.submit_exam_attempt(v_exam_id, jsonb_build_object(v_question_id::text, 'A'::text), '[]'::jsonb);
  insert into security_matrix_results values ('ATTEMPT SECURITY', 'submit_exam_attempt works for legitimate student', case when v_attempt_id is not null then 'PASS' else 'FAIL' end, coalesce(v_attempt_id::text, '<null>'));

  v_duplicate_attempt_id := public.submit_exam_attempt(v_exam_id, jsonb_build_object(v_question_id::text, 'A'::text), '[]'::jsonb);
  insert into security_matrix_results values ('ATTEMPT SECURITY', 'Duplicate submission for same authorized start is idempotent', case when v_duplicate_attempt_id = v_attempt_id then 'PASS' else 'FAIL' end, coalesce(v_duplicate_attempt_id::text, '<null>'));

  begin
    delete from public.exam_attempts where id = v_attempt_id;
    get diagnostics row_count = row_count;
    insert into security_matrix_results values (
      'ATTEMPT SECURITY',
      'Student cannot delete attempts to reset attempt limits',
      case when row_count = 0 then 'PASS' else 'FAIL' end,
      row_count::text || ' row(s) deleted'
    );
  exception when others then
    insert into security_matrix_results values ('ATTEMPT SECURITY', 'Student cannot delete attempts to reset attempt limits', 'PASS', sqlerrm);
  end;

  begin
    update public.profiles set role = 'Admin' where id = v_student_id;
    insert into security_matrix_results values ('PROFILE SECURITY', 'User cannot self-change role', 'FAIL', 'role update succeeded');
  exception when others then
    insert into security_matrix_results values ('PROFILE SECURITY', 'User cannot self-change role', 'PASS', sqlerrm);
  end;

  update public.profiles set theme_color = '#111111' where id = v_student_id;
  insert into security_matrix_results values ('PROFILE SECURITY', 'User can update allowed personal profile fields', 'PASS', 'theme_color update accepted');

  perform pg_temp.as_user(v_outsider_id);
  perform public.join_course_by_code('JOINSEC');
  select count(*) into row_count from public.course_enrollments ce where ce.course_id = v_course_id and ce.student_id = v_outsider_id;
  insert into security_matrix_results values ('COURSE SECURITY', 'Student can join through join_course_by_code where legitimate', case when row_count = 1 then 'PASS' else 'FAIL' end, row_count::text || ' enrollment(s)');

  select count(*) into row_count from public.courses where id = v_private_course_id;
  insert into security_matrix_results values ('COURSE SECURITY', 'Student cannot read unrelated private course data', case when row_count = 0 then 'PASS' else 'FAIL' end, row_count::text || ' visible private course row(s)');

  perform pg_temp.as_user(v_student_id);
  select count(*) into row_count from public.exams where id = v_draft_exam_id;
  insert into security_matrix_results values ('EXAM SECURITY', 'Pending Review exams are not exposed to students', case when row_count = 0 then 'PASS' else 'FAIL' end, row_count::text || ' visible pending row(s)');

  insert into public.violations (student_id, exam_id, course_id, professor_id, violation_type, severity, description)
  values (v_student_id, v_exam_id, v_course_id, v_professor_id, 'AUDIO_DETECTED', 'Low', 'Runtime audio test');
  insert into security_matrix_results values ('VIOLATION SECURITY', 'Audio violation insert with course_id/professor_id succeeds where legitimate', 'PASS', 'insert accepted');

  begin
    insert into public.notifications (user_id, title, message, type)
    values (v_student_id, 'bad', 'bad', 'bad');
    insert into security_matrix_results values ('NOTIFICATION SECURITY', 'Arbitrary authenticated notification insertion is denied', 'FAIL', 'direct insert succeeded');
  exception when others then
    insert into security_matrix_results values ('NOTIFICATION SECURITY', 'Arbitrary authenticated notification insertion is denied', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_user(v_professor_id);
  v_notification_id := public.create_notification('exam_review_request', v_cluster_id, 'Review requested', 'Please review.', 'exam_review_request', v_draft_exam_id);
  insert into security_matrix_results values ('NOTIFICATION SECURITY', 'create_notification permits exam_review_request only when authorized', case when v_notification_id is not null then 'PASS' else 'FAIL' end, coalesce(v_notification_id::text, '<null>'));

  perform pg_temp.as_user(v_cluster_id);
  begin
    update public.exams set title = 'Cluster overwrite' where id = v_exam_id;
    get diagnostics row_count = row_count;
    insert into security_matrix_results values (
      'CLUSTER PROFESSOR',
      'Direct unrestricted exam update remains blocked',
      case when row_count = 0 then 'PASS' else 'FAIL' end,
      row_count::text || ' row(s) updated'
    );
  exception when others then
    insert into security_matrix_results values ('CLUSTER PROFESSOR', 'Direct unrestricted exam update remains blocked', 'PASS', sqlerrm);
  end;
end $$;

select area, test, status, observed
from security_matrix_results
order by area, test;

rollback;
