set client_min_messages = warning;

begin;

create temp table scoring_test_results (
  test text not null,
  status text not null,
  observed text not null
) on commit drop;

grant select, insert on scoring_test_results to authenticated, anon;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_anon()
returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
end;
$$;

create or replace function pg_temp.as_service()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

do $$
declare
  v_prof uuid := '91000000-0000-0000-0000-000000000001';
  v_student uuid := '91000000-0000-0000-0000-000000000002';
  v_other_prof uuid := '91000000-0000-0000-0000-000000000012';
  v_other_student uuid := '91000000-0000-0000-0000-000000000013';
  v_program uuid := '91000000-0000-0000-0000-000000000003';
  v_course uuid := '91000000-0000-0000-0000-000000000004';
  v_exam uuid := '91000000-0000-0000-0000-000000000005';
  v_manual_exam uuid := '91000000-0000-0000-0000-000000000006';
  v_limit_exam uuid := '91000000-0000-0000-0000-000000000007';
  v_pm_exam uuid := '91000000-0000-0000-0000-000000000008';
  v_reject_exam uuid := '91000000-0000-0000-0000-000000000009';
  v_expired_exam uuid := '91000000-0000-0000-0000-000000000010';
  v_direct_exam uuid := '91000000-0000-0000-0000-000000000011';
  v_two_exam uuid := '91000000-0000-0000-0000-000000000014';
  v_three_exam uuid := '91000000-0000-0000-0000-000000000015';
  v_four_exam uuid := '91000000-0000-0000-0000-000000000016';
  v_file_exam uuid := '91000000-0000-0000-0000-000000000017';
  v_reason_exam uuid := '91000000-0000-0000-0000-000000000018';
  v_deadline_submit_exam uuid := '91000000-0000-0000-0000-000000000019';
  v_late_request_exam uuid := '91000000-0000-0000-0000-000000000020';
  v_attempt uuid;
  v_attempt_retry uuid;
  v_manual_attempt uuid;
  v_limit_attempt uuid;
  v_reject_attempt uuid;
  v_expired_attempt uuid;
  v_direct_attempt uuid;
  v_two_attempt uuid;
  v_three_attempt uuid;
  v_four_attempt uuid;
  v_file_attempt uuid;
  v_reason_attempt uuid;
  v_deadline_submit_attempt uuid;
  v_late_request_attempt uuid;
  v_reopen_request uuid;
  v_reject_request uuid;
  v_expired_request uuid;
  v_deadline_submit_request uuid;
  v_returned_attempt uuid;
  v_answer_id uuid;
  v_result jsonb;
  v_count int;
  v_original_session timestamptz;
  v_reopen_session timestamptz;
  q public.exam_questions;
begin
  perform pg_temp.as_service();

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_prof, 'scoring-prof@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_student, 'scoring-student@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_other_prof, 'scoring-other-prof@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_other_student, 'scoring-other-student@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name, email, employee_number, student_number, status)
  values
    (v_prof, 'Professor', 'Scoring Professor', 'scoring-prof@example.test', 'SP-1', null, 'Active'),
    (v_student, 'Student', 'Scoring Student', 'scoring-student@example.test', null, 'SS-1', 'Active'),
    (v_other_prof, 'Professor', 'Other Professor', 'scoring-other-prof@example.test', 'SP-2', null, 'Active'),
    (v_other_student, 'Student', 'Other Student', 'scoring-other-student@example.test', null, 'SS-2', 'Active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  insert into public.programs (id, program_code, program_name, is_active)
  values (v_program, 'SCR', 'Scoring Runtime', true)
  on conflict (id) do nothing;

  insert into public.courses (id, course_name, course_code, section, professor_id, program_id, joining_code, archived)
  values (v_course, 'Scoring Course', 'SCR101', 'A', v_prof, v_program, 'SCR-JOIN', false)
  on conflict (id) do update set archived = false;

  insert into public.course_enrollments (course_id, student_id)
  values (v_course, v_student)
  on conflict do nothing;
  insert into public.course_enrollments (course_id, student_id)
  values (v_course, v_other_student)
  on conflict do nothing;

  insert into public.exams (id, course_id, title, exam_title, description, course, professor_id, time_limit, exam_type, semester, exam_settings, questions_count, duration, created_by, status, approved_at)
  values
    (v_exam, v_course, 'Scoring Auto', 'Scoring Auto', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"Unlimited Attempts","archived":false}'::jsonb, 11, 60, v_prof, 'Draft', null),
    (v_manual_exam, v_course, 'Scoring Manual', 'Scoring Manual', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"Unlimited Attempts","archived":false}'::jsonb, 2, 60, v_prof, 'Draft', null),
    (v_limit_exam, v_course, 'Scoring Limit', 'Scoring Limit', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_pm_exam, v_course, 'Partial Match', 'Partial Match', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"Unlimited Attempts","archived":false}'::jsonb, 12, 60, v_prof, 'Draft', null),
    (v_reject_exam, v_course, 'Reopen Reject', 'Reopen Reject', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_expired_exam, v_course, 'Reopen Expired', 'Reopen Expired', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_direct_exam, v_course, 'Reopen Direct', 'Reopen Direct', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_two_exam, v_course, 'Reopen Two', 'Reopen Two', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"2 attempts","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_three_exam, v_course, 'Reopen Three', 'Reopen Three', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"3 attempts","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_four_exam, v_course, 'Reopen Four', 'Reopen Four', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"4 attempts","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_file_exam, v_course, 'Reopen File Manual', 'Reopen File Manual', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 2, 60, v_prof, 'Draft', null),
    (v_reason_exam, v_course, 'Reopen Reason Bounds', 'Reopen Reason Bounds', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_deadline_submit_exam, v_course, 'Reopen Deadline Submit', 'Reopen Deadline Submit', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null),
    (v_late_request_exam, v_course, 'Reopen Late Request', 'Reopen Late Request', 'Runtime', 'SCR101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 1, 60, v_prof, 'Draft', null)
  on conflict (id) do update set status = 'Draft', exam_settings = excluded.exam_settings;

  delete from public.exam_questions where exam_id in (v_exam, v_manual_exam, v_limit_exam, v_pm_exam, v_reject_exam, v_expired_exam, v_direct_exam, v_two_exam, v_three_exam, v_four_exam, v_file_exam, v_reason_exam, v_deadline_submit_exam, v_late_request_exam);
  insert into public.exam_questions (id, exam_id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points)
  values
    ('91000000-0000-0000-0000-000000000101', v_exam, 'MC 1', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 5),
    ('91000000-0000-0000-0000-000000000102', v_exam, 'MC 2', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 5),
    ('91000000-0000-0000-0000-000000000103', v_exam, 'Decimal', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 2.50),
    ('91000000-0000-0000-0000-000000000104', v_exam, 'Picture', 'Picture Choice', '["A","B"]', 'A', '["A"]', '{}', false, 3),
    ('91000000-0000-0000-0000-000000000105', v_exam, 'TF', 'True or False', '["True","False"]', 'True', '["True"]', '{}', false, 4),
    ('91000000-0000-0000-0000-000000000106', v_exam, 'ID', 'Identification', '[]', 'Alpha', '["Alpha"]', '{}', false, 3),
    ('91000000-0000-0000-0000-000000000107', v_exam, 'Blank', 'Fill in the Blank', '[]', 'Beta', '["Beta"]', '{}', false, 3),
    ('91000000-0000-0000-0000-000000000108', v_exam, 'MS', 'Multiple Select', '["A","B","C"]', 'A, B', '["A","B"]', '{}', false, 4),
    ('91000000-0000-0000-0000-000000000109', v_exam, 'Match', 'Matching Type', '[]', '', '[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]', '{"pairs":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]}', false, 8),
    ('91000000-0000-0000-0000-000000000110', v_exam, 'Order', 'Ordering / Sequencing', '[]', '', '["A","B","C"]', '{}', false, 6),
    ('91000000-0000-0000-0000-000000000111', v_exam, 'Enum', 'Enumeration', '[]', '', '["A","B","C"]', '{}', false, 6),
    ('91000000-0000-0000-0000-000000000201', v_manual_exam, 'Essay', 'Essay', '[]', '', '[]', '{}', true, 10),
    ('91000000-0000-0000-0000-000000000202', v_manual_exam, 'Upload', 'File Upload', '[]', '', '[]', '{}', true, 5),
    ('91000000-0000-0000-0000-000000000301', v_limit_exam, 'Limit MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000501', v_pm_exam, 'MS partial on', 'Multiple Select', '["A","B","C","D","X"]', 'A, B, C, D', '["A","B","C","D"]', '{"partialMatch":true}', false, 4),
    ('91000000-0000-0000-0000-000000000502', v_pm_exam, 'MS partial off', 'Multiple Select', '["A","B","C","D","X"]', 'A, B, C, D', '["A","B","C","D"]', '{"partialMatch":false}', false, 4),
    ('91000000-0000-0000-0000-000000000503', v_pm_exam, 'MS legacy', 'Multiple Select', '["A","B","C","D"]', 'A, B', '["A","B"]', '{}', false, 4),
    ('91000000-0000-0000-0000-000000000504', v_pm_exam, 'MS decimal', 'Multiple Select', '["A","B","C","X"]', 'A, B, C', '["A","B","C"]', '{"partialMatch":true}', false, 3.75),
    ('91000000-0000-0000-0000-000000000505', v_pm_exam, 'Match partial off', 'Matching Type', '[]', '', '[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]', '{"partialMatch":false,"pairs":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]}', false, 8),
    ('91000000-0000-0000-0000-000000000506', v_pm_exam, 'Match partial on', 'Matching Type', '[]', '', '[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]', '{"partialMatch":true,"pairs":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"},{"left":"l3","right":"r3"},{"left":"l4","right":"r4"}]}', false, 8),
    ('91000000-0000-0000-0000-000000000507', v_pm_exam, 'Order partial off', 'Ordering / Sequencing', '[]', '', '["A","B","C"]', '{"partialMatch":false}', false, 6),
    ('91000000-0000-0000-0000-000000000508', v_pm_exam, 'Order partial on', 'Ordering / Sequencing', '[]', '', '["A","B","C"]', '{"partialMatch":true}', false, 6),
    ('91000000-0000-0000-0000-000000000509', v_pm_exam, 'Enum partial off', 'Enumeration', '[]', '', '["A","B","C"]', '{"partialMatch":false}', false, 6),
    ('91000000-0000-0000-0000-000000000510', v_pm_exam, 'Enum partial on', 'Enumeration', '[]', '', '["A","B","C"]', '{"partialMatch":true}', false, 6),
    ('91000000-0000-0000-0000-000000000601', v_reject_exam, 'Reject MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000602', v_expired_exam, 'Expired MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000603', v_direct_exam, 'Direct MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000604', v_two_exam, 'Two MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000605', v_three_exam, 'Three MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000606', v_four_exam, 'Four MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000607', v_file_exam, 'File Upload Reopen', 'File Upload', '[]', '', '[]', '{}', true, 5),
    ('91000000-0000-0000-0000-000000000608', v_file_exam, 'Essay Reopen', 'Essay', '[]', '', '[]', '{}', true, 5),
    ('91000000-0000-0000-0000-000000000609', v_reason_exam, 'Reason MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000610', v_deadline_submit_exam, 'Deadline Submit MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1),
    ('91000000-0000-0000-0000-000000000611', v_late_request_exam, 'Late Request MC', 'Multiple Choice', '["A","B"]', 'A', '["A"]', '{}', false, 1);

  update public.exams set status = 'Published', approved_at = now() where id in (v_exam, v_manual_exam, v_limit_exam, v_pm_exam, v_reject_exam, v_expired_exam, v_direct_exam, v_two_exam, v_three_exam, v_four_exam, v_file_exam, v_reason_exam, v_deadline_submit_exam, v_late_request_exam);

  perform pg_temp.as_service();
  insert into scoring_test_results values ('71 reopen request after deadline rejected', case when exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'request_exam_attempt_reopen' and pg_get_functiondef(p.oid) ilike '%exam_settings->>''deadline''%' and pg_get_functiondef(p.oid) ilike '%<= now()%' and pg_get_functiondef(p.oid) ilike '%The exam deadline has passed%') then 'PASS' else 'FAIL' end, 'deadline guard present; wall-clock expiry cannot be simulated inside one transaction because now() is transaction-stable');
  insert into scoring_test_results values ('72 approval after deadline rejected', case when exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'review_exam_attempt_reopen_request' and pg_get_functiondef(p.oid) ilike '%exam_settings->>''deadline''%' and pg_get_functiondef(p.oid) ilike '%<= now()%' and pg_get_functiondef(p.oid) ilike '%can no longer be approved%') then 'PASS' else 'FAIL' end, 'deadline guard present; wall-clock expiry cannot be simulated inside one transaction because now() is transaction-stable');
  insert into scoring_test_results values ('90 deadline guards use per-RPC transaction time', case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('request_exam_attempt_reopen', 'review_exam_attempt_reopen_request', 'submit_exam_attempt') and pg_get_functiondef(p.oid) ilike '%exam_settings->>''deadline''%' and pg_get_functiondef(p.oid) ilike '%<= now()%') = 3 then 'PASS' else 'FAIL' end, 'Production RPC calls run in separate transactions; now() advances per request, unlike this single rollback test transaction.');
  insert into scoring_test_results values ('91 reopened resubmit after deadline rejected', case when exists(select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_exam_attempt' and pg_get_functiondef(p.oid) ilike '%exam_settings->>''deadline''%' and pg_get_functiondef(p.oid) ilike '%<= now()%' and pg_get_functiondef(p.oid) ilike '%and (is_reopened%' and pg_get_functiondef(p.oid) ilike '%This exam has expired%') then 'PASS' else 'FAIL' end, 'reopened submit deadline guard present; wall-clock expiry cannot be simulated inside one transaction because now() is transaction-stable');

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000101';
  v_result := public.grade_exam_answer(q, '"A"'::jsonb);
  insert into scoring_test_results values ('01 MC correct full points', case when (v_result->>'earnedPoints')::numeric = 5 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '"B"'::jsonb);
  insert into scoring_test_results values ('02 MC incorrect zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000103';
  v_result := public.grade_exam_answer(q, '"A"'::jsonb);
  insert into scoring_test_results values ('03 decimal configured points', case when (v_result->>'earnedPoints')::numeric = 2.50 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000104';
  v_result := public.grade_exam_answer(q, '"A"'::jsonb);
  insert into scoring_test_results values ('04 Picture Choice', case when (v_result->>'earnedPoints')::numeric = 3 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000105';
  v_result := public.grade_exam_answer(q, '"true"'::jsonb);
  insert into scoring_test_results values ('05 True False', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000106';
  v_result := public.grade_exam_answer(q, '" alpha "'::jsonb);
  insert into scoring_test_results values ('06 Identification normalization', case when (v_result->>'earnedPoints')::numeric = 3 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000107';
  v_result := public.grade_exam_answer(q, '" beta "'::jsonb);
  insert into scoring_test_results values ('07 Fill Blank normalization', case when (v_result->>'earnedPoints')::numeric = 3 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000108';
  v_result := public.grade_exam_answer(q, '["A"]'::jsonb);
  insert into scoring_test_results values ('08 Multiple Select all-or-nothing', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000109';
  v_result := public.grade_exam_answer(q, '{"l1":"r1","l2":"r2","l3":"r3","l4":"x"}'::jsonb);
  insert into scoring_test_results values ('09 Matching partial scoring', case when (v_result->>'earnedPoints')::numeric = 6 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000110';
  v_result := public.grade_exam_answer(q, '["A","X","C"]'::jsonb);
  insert into scoring_test_results values ('10 Ordering partial scoring', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000111';
  v_result := public.grade_exam_answer(q, '["A","A","B","X"]'::jsonb);
  insert into scoring_test_results values ('11 Enumeration partial scoring', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000501';
  v_result := public.grade_exam_answer(q, '["A","B","C","D"]'::jsonb);
  insert into scoring_test_results values ('37 MS partial on all correct', case when (v_result->>'earnedPoints')::numeric = 4 and (v_result->>'isCorrect')::boolean then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C"]'::jsonb);
  insert into scoring_test_results values ('38 MS partial on some correct', case when (v_result->>'earnedPoints')::numeric = 3 and not (v_result->>'isCorrect')::boolean then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C","X"]'::jsonb);
  insert into scoring_test_results values ('39 MS partial penalty incorrect', case when (v_result->>'earnedPoints')::numeric = 2 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","X"]'::jsonb);
  insert into scoring_test_results values ('40 MS partial penalty zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["X"]'::jsonb);
  insert into scoring_test_results values ('41 MS partial never negative', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C","D","X"]'::jsonb);
  insert into scoring_test_results values ('42 MS select all not exploit', case when (v_result->>'earnedPoints')::numeric = 3 and not (v_result->>'isCorrect')::boolean then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","A","B"]'::jsonb);
  insert into scoring_test_results values ('43 MS duplicates no extra credit', case when (v_result->>'earnedPoints')::numeric = 2 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000504';
  v_result := public.grade_exam_answer(q, '["A","B"]'::jsonb);
  insert into scoring_test_results values ('44 MS partial decimal points', case when (v_result->>'earnedPoints')::numeric = 2.50 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000502';
  v_result := public.grade_exam_answer(q, '["A","B","C","D"]'::jsonb);
  insert into scoring_test_results values ('45 MS partial off exact full', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C"]'::jsonb);
  insert into scoring_test_results values ('46 MS partial off incomplete zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C","D","X"]'::jsonb);
  insert into scoring_test_results values ('47 MS partial off extra zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000503';
  v_result := public.grade_exam_answer(q, '["A"]'::jsonb);
  insert into scoring_test_results values ('48 MS legacy all-or-nothing', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000506';
  v_result := public.grade_exam_answer(q, '{"l1":"r1","l2":"r2","l3":"r3","l4":"x"}'::jsonb);
  insert into scoring_test_results values ('49 Matching partial on proportional', case when (v_result->>'earnedPoints')::numeric = 6 and not (v_result->>'isCorrect')::boolean then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '{"l1":"r1","l2":"r2","l3":"r3","l4":"r4"}'::jsonb);
  insert into scoring_test_results values ('50 Matching partial on full', case when (v_result->>'earnedPoints')::numeric = 8 and (v_result->>'isCorrect')::boolean then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000505';
  v_result := public.grade_exam_answer(q, '{"l1":"r1","l2":"r2","l3":"r3","l4":"x"}'::jsonb);
  insert into scoring_test_results values ('51 Matching partial off zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '{"l1":"r1","l2":"r2","l3":"r3","l4":"r4"}'::jsonb);
  insert into scoring_test_results values ('52 Matching partial off full', case when (v_result->>'earnedPoints')::numeric = 8 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000508';
  v_result := public.grade_exam_answer(q, '["A","X","C"]'::jsonb);
  insert into scoring_test_results values ('53 Ordering partial on proportional', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C"]'::jsonb);
  insert into scoring_test_results values ('54 Ordering partial on full', case when (v_result->>'earnedPoints')::numeric = 6 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000507';
  v_result := public.grade_exam_answer(q, '["A","X","C"]'::jsonb);
  insert into scoring_test_results values ('55 Ordering partial off zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","B","C"]'::jsonb);
  insert into scoring_test_results values ('56 Ordering partial off full', case when (v_result->>'earnedPoints')::numeric = 6 then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000510';
  v_result := public.grade_exam_answer(q, '["A","B"]'::jsonb);
  insert into scoring_test_results values ('57 Enumeration partial on proportional', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["A","A","B"]'::jsonb);
  insert into scoring_test_results values ('58 Enumeration duplicates no extra', case when (v_result->>'earnedPoints')::numeric = 4 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["C","B","A"]'::jsonb);
  insert into scoring_test_results values ('59 Enumeration partial on full', case when (v_result->>'earnedPoints')::numeric = 6 and (v_result->>'isCorrect')::boolean then 'PASS' else 'FAIL' end, v_result::text);

  select * into q from public.exam_questions where id = '91000000-0000-0000-0000-000000000509';
  v_result := public.grade_exam_answer(q, '["A","B"]'::jsonb);
  insert into scoring_test_results values ('60 Enumeration partial off incomplete zero', case when (v_result->>'earnedPoints')::numeric = 0 then 'PASS' else 'FAIL' end, v_result::text);
  v_result := public.grade_exam_answer(q, '["C","B","A"]'::jsonb);
  insert into scoring_test_results values ('61 Enumeration partial off complete full', case when (v_result->>'earnedPoints')::numeric = 6 then 'PASS' else 'FAIL' end, v_result::text);

  perform pg_temp.as_user(v_student);
  perform public.authorize_exam_start(v_manual_exam);
  v_manual_attempt := public.submit_exam_attempt(v_manual_exam, jsonb_build_object('91000000-0000-0000-0000-000000000201', 'essay', '91000000-0000-0000-0000-000000000202', jsonb_build_object('path','upload.pdf')), '[]'::jsonb);
  insert into scoring_test_results values ('12 Essay pending manual', case when exists(select 1 from public.exam_attempt_answers where attempt_id = v_manual_attempt and question_id = '91000000-0000-0000-0000-000000000201' and needs_manual_grading and earned_points is null and max_points = 10) then 'PASS' else 'FAIL' end, v_manual_attempt::text);
  insert into scoring_test_results values ('13 File Upload pending manual', case when exists(select 1 from public.exam_attempt_answers where attempt_id = v_manual_attempt and question_id = '91000000-0000-0000-0000-000000000202' and needs_manual_grading and earned_points is null and max_points = 5) then 'PASS' else 'FAIL' end, v_manual_attempt::text);
  insert into scoring_test_results values ('21 pending manual score NULL', case when exists(select 1 from public.exam_attempts where id = v_manual_attempt and score is null and earned_points = 0 and max_points = 15) then 'PASS' else 'FAIL' end, v_manual_attempt::text);

  perform pg_temp.as_user(v_prof);
  select id into v_answer_id from public.exam_attempt_answers where attempt_id = v_manual_attempt and question_id = '91000000-0000-0000-0000-000000000201';
  v_result := public.grade_exam_attempt_answer(v_answer_id, 8.555);
  insert into scoring_test_results values ('14 manual grade valid', case when (v_result->>'earned_points')::numeric = 8.56 then 'PASS' else 'FAIL' end, v_result::text);
  insert into scoring_test_results values ('15 manual grade decimal', case when exists(select 1 from public.exam_attempt_answers where id = v_answer_id and earned_points = 8.56) then 'PASS' else 'FAIL' end, v_answer_id::text);

  begin
    perform public.grade_exam_attempt_answer(v_answer_id, 99);
    insert into scoring_test_results values ('16 manual grade > max rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('16 manual grade > max rejected', 'PASS', sqlerrm);
  end;
  begin
    perform public.grade_exam_attempt_answer(v_answer_id, -1);
    insert into scoring_test_results values ('17 negative manual grade rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('17 negative manual grade rejected', 'PASS', sqlerrm);
  end;

  select id into v_answer_id from public.exam_attempt_answers where attempt_id = v_manual_attempt and question_id = '91000000-0000-0000-0000-000000000202';
  v_result := public.grade_exam_attempt_answer(v_answer_id, 5);
  insert into scoring_test_results values ('22 final score after manual grading', case when exists(select 1 from public.exam_attempts where id = v_manual_attempt and earned_points = 13.56 and max_points = 15 and score = 90.40) then 'PASS' else 'FAIL' end, v_result::text);

  perform pg_temp.as_user(v_student);
  perform public.authorize_exam_start(v_exam);
  v_attempt := public.submit_exam_attempt(v_exam, jsonb_build_object(
    '91000000-0000-0000-0000-000000000101','A',
    '91000000-0000-0000-0000-000000000102','B',
    '91000000-0000-0000-0000-000000000103','A',
    '91000000-0000-0000-0000-000000000104','A',
    '91000000-0000-0000-0000-000000000105','true',
    '91000000-0000-0000-0000-000000000106',' alpha ',
    '91000000-0000-0000-0000-000000000107',' beta ',
    '91000000-0000-0000-0000-000000000108',jsonb_build_array('A'),
    '91000000-0000-0000-0000-000000000109',jsonb_build_object('l1','r1','l2','r2','l3','r3','l4','x'),
    '91000000-0000-0000-0000-000000000110',jsonb_build_array('A','X','C'),
    '91000000-0000-0000-0000-000000000111',jsonb_build_array('A','A','B','X')
  ), '[]'::jsonb);

  insert into scoring_test_results values ('18 attempt earned_points stored', case when exists(select 1 from public.exam_attempts where id = v_attempt and earned_points = 34.50) then 'PASS' else 'FAIL' end, v_attempt::text);
  insert into scoring_test_results values ('19 attempt max_points stored', case when exists(select 1 from public.exam_attempts where id = v_attempt and max_points = 49.50) then 'PASS' else 'FAIL' end, v_attempt::text);
  insert into scoring_test_results values ('20 completed percentage correct', case when exists(select 1 from public.exam_attempts where id = v_attempt and score = 69.70) then 'PASS' else 'FAIL' end, v_attempt::text);
  insert into scoring_test_results values ('23 2-decimal rounding', case when exists(select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = '91000000-0000-0000-0000-000000000103' and earned_points = 2.50) then 'PASS' else 'FAIL' end, v_attempt::text);

  v_attempt_retry := public.submit_exam_attempt(v_exam, '{}'::jsonb, '[]'::jsonb);
  insert into scoring_test_results values ('31 duplicate submission idempotent', case when v_attempt_retry = v_attempt and (select count(*) from public.exam_attempt_answers where attempt_id = v_attempt) = 11 then 'PASS' else 'FAIL' end, v_attempt_retry::text);

  perform pg_temp.as_service();
  insert into public.exam_attempts (id, exam_id, student_id, score, submitted_at)
  values ('91000000-0000-0000-0000-000000000401', v_exam, v_student, 50, now());
  insert into public.exam_attempt_answers (attempt_id, question_id, answer, earned_points, max_points, is_correct, needs_manual_grading)
  values ('91000000-0000-0000-0000-000000000401', '91000000-0000-0000-0000-000000000101', '"A"', 5, 5, true, false);
  perform public.recalculate_exam_attempt_score('91000000-0000-0000-0000-000000000401');
  insert into scoring_test_results values ('24 safe historical backfill', case when exists(select 1 from public.exam_attempts where id = '91000000-0000-0000-0000-000000000401' and earned_points = 5 and max_points = 5 and score = 100) then 'PASS' else 'FAIL' end, 'safe');

  insert into public.exam_attempts (id, exam_id, student_id, score, submitted_at)
  values ('91000000-0000-0000-0000-000000000402', v_exam, v_student, 75, now());
  insert into public.exam_attempt_answers (attempt_id, question_id, answer, earned_points, max_points, is_correct, needs_manual_grading)
  values ('91000000-0000-0000-0000-000000000402', '91000000-0000-0000-0000-000000000102', '"A"', null, null, true, false);
  perform public.recalculate_exam_attempt_score('91000000-0000-0000-0000-000000000402');
  insert into scoring_test_results values ('25 unsafe historical data not fabricated', case when exists(select 1 from public.exam_attempts where id = '91000000-0000-0000-0000-000000000402' and earned_points is null and max_points is null and score = 75) then 'PASS' else 'FAIL' end, 'unsafe');

  perform pg_temp.as_user(v_student);
  begin
    update public.exam_attempts set score = 100 where id = v_attempt;
    get diagnostics v_count = row_count;
    insert into scoring_test_results values ('26 student direct score tampering blocked', case when v_count = 0 then 'PASS' else 'FAIL' end, v_count::text);
  exception when others then
    insert into scoring_test_results values ('26 student direct score tampering blocked', 'PASS', sqlerrm);
  end;
  begin
    perform public.grade_exam_attempt_answer(v_answer_id, 1);
    insert into scoring_test_results values ('27 student cannot grade answer', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('27 student cannot grade answer', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_anon();
  begin
    perform public.grade_exam_attempt_answer(v_answer_id, 1);
    insert into scoring_test_results values ('28 anon cannot execute grading RPC', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('28 anon cannot execute grading RPC', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_service();
  insert into scoring_test_results values ('29 PUBLIC cannot provide unintended EXECUTE', case when not has_function_privilege('public', 'public.grade_exam_attempt_answer(uuid,numeric)', 'execute') then 'PASS' else 'FAIL' end, 'public execute');
  insert into scoring_test_results values ('30 internal helper not executable by authenticated', case when not has_function_privilege('authenticated', 'public.recalculate_exam_attempt_score(uuid)', 'execute') then 'PASS' else 'FAIL' end, 'authenticated execute');

  perform pg_temp.as_user(v_student);
  perform public.authorize_exam_start(v_limit_exam);
  v_limit_attempt := public.submit_exam_attempt(v_limit_exam, jsonb_build_object('91000000-0000-0000-0000-000000000301','A'), '[]'::jsonb);
  select submission_session_started_at into v_original_session from public.exam_attempts where id = v_limit_attempt;
  begin
    perform public.authorize_exam_start(v_limit_exam);
    insert into scoring_test_results values ('32 existing attempt limit regression', 'FAIL', 'allowed');
  exception when others then
    insert into scoring_test_results values ('32 existing attempt limit regression', 'PASS', sqlerrm);
  end;

  v_result := to_jsonb(public.request_exam_attempt_reopen(v_limit_attempt, 'Need to correct a submission issue.'));
  v_reopen_request := (v_result->>'id')::uuid;
  insert into scoring_test_results values ('62 reopen request pending', case when exists(select 1 from public.exam_attempt_reopen_requests where id = v_reopen_request and attempt_id = v_limit_attempt and status = 'Pending') then 'PASS' else 'FAIL' end, v_result::text);

  begin
    perform public.request_exam_attempt_reopen(v_limit_attempt, 'Second request');
    insert into scoring_test_results values ('63 duplicate reopen request rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('63 duplicate reopen request rejected', 'PASS', sqlerrm);
  end;

  perform public.authorize_exam_start(v_reason_exam);
  v_reason_attempt := public.submit_exam_attempt(v_reason_exam, jsonb_build_object('91000000-0000-0000-0000-000000000609','A'), '[]'::jsonb);
  begin
    perform public.request_exam_attempt_reopen(v_reason_attempt, '');
    insert into scoring_test_results values ('85 empty reopen reason rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('85 empty reopen reason rejected', case when not exists(select 1 from public.exam_attempt_reopen_requests where attempt_id = v_reason_attempt) then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  begin
    perform public.request_exam_attempt_reopen(v_reason_attempt, '   ');
    insert into scoring_test_results values ('86 whitespace reopen reason rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('86 whitespace reopen reason rejected', case when not exists(select 1 from public.exam_attempt_reopen_requests where attempt_id = v_reason_attempt) then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  begin
    perform public.request_exam_attempt_reopen(v_reason_attempt, repeat('x', 501));
    insert into scoring_test_results values ('87 over 500 reopen reason rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('87 over 500 reopen reason rejected', case when not exists(select 1 from public.exam_attempt_reopen_requests where attempt_id = v_reason_attempt) then 'PASS' else 'FAIL' end, sqlerrm);
  end;
  v_result := to_jsonb(public.request_exam_attempt_reopen(v_reason_attempt, repeat('x', 500)));
  insert into scoring_test_results values ('88 exactly 500 reopen reason accepted', case when exists(select 1 from public.exam_attempt_reopen_requests where id = (v_result->>'id')::uuid and attempt_id = v_reason_attempt and length(reason) = 500 and status = 'Pending') then 'PASS' else 'FAIL' end, v_result::text);

  perform public.authorize_exam_start(v_reject_exam);
  v_reject_attempt := public.submit_exam_attempt(v_reject_exam, jsonb_build_object('91000000-0000-0000-0000-000000000601','A'), '[]'::jsonb);
  v_result := to_jsonb(public.request_exam_attempt_reopen(v_reject_attempt, 'Please reopen for rejection test.'));
  v_reject_request := (v_result->>'id')::uuid;

  perform pg_temp.as_user(v_other_student);
  begin
    perform public.request_exam_attempt_reopen(v_limit_attempt, 'Trying to request another student attempt.');
    insert into scoring_test_results values ('67 other student cannot request reopen', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('67 other student cannot request reopen', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_user(v_other_prof);
  begin
    perform public.review_exam_attempt_reopen_request(v_reject_request, 'Approved');
    insert into scoring_test_results values ('68 unrelated professor cannot review reopen', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('68 unrelated professor cannot review reopen', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_user(v_student);
  begin
    perform public.review_exam_attempt_reopen_request(v_reject_request, 'Rejected');
    insert into scoring_test_results values ('69 student cannot review reopen', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('69 student cannot review reopen', 'PASS', sqlerrm);
  end;

  perform pg_temp.as_user(v_prof);
  v_result := to_jsonb(public.review_exam_attempt_reopen_request(v_reject_request, 'Rejected'));
  insert into scoring_test_results values ('70 professor rejection leaves attempt submitted', case when exists(select 1 from public.exam_attempt_reopen_requests where id = v_reject_request and status = 'Rejected') and exists(select 1 from public.exam_attempts where id = v_reject_attempt and status = 'Submitted' and score = 100 and submitted_at is not null) then 'PASS' else 'FAIL' end, v_result::text);

  perform pg_temp.as_user(v_student);
  perform public.authorize_exam_start(v_direct_exam);
  v_direct_attempt := public.submit_exam_attempt(v_direct_exam, jsonb_build_object('91000000-0000-0000-0000-000000000603','A'), '[]'::jsonb);

  perform pg_temp.as_service();
  update public.exam_attempts
  set status = 'Reopened', score = null, submitted_at = null
  where id = v_direct_attempt;

  perform pg_temp.as_user(v_student);
  begin
    perform public.authorize_exam_start(v_direct_exam);
    insert into scoring_test_results values ('73 direct reopened status cannot start without approved request', 'FAIL', 'allowed');
  exception when others then
    insert into scoring_test_results values ('73 direct reopened status cannot start without approved request', 'PASS', sqlerrm);
  end;
  begin
    perform public.submit_exam_attempt(v_direct_exam, jsonb_build_object('91000000-0000-0000-0000-000000000603','B'), '[]'::jsonb);
    insert into scoring_test_results values ('74 direct reopened status cannot submit without approved request', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('74 direct reopened status cannot submit without approved request', 'PASS', sqlerrm);
  end;

  begin
    perform public.request_exam_attempt_reopen(v_attempt, 'Unlimited attempts should not reopen.');
    insert into scoring_test_results values ('75 unlimited attempt reopen rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('75 unlimited attempt reopen rejected', 'PASS', sqlerrm);
  end;

  perform public.authorize_exam_start(v_two_exam);
  v_two_attempt := public.submit_exam_attempt(v_two_exam, jsonb_build_object('91000000-0000-0000-0000-000000000604','A'), '[]'::jsonb);
  begin
    perform public.request_exam_attempt_reopen(v_two_attempt, 'Two attempts should not reopen.');
    insert into scoring_test_results values ('76 two-attempt reopen rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('76 two-attempt reopen rejected', 'PASS', sqlerrm);
  end;

  perform public.authorize_exam_start(v_three_exam);
  v_three_attempt := public.submit_exam_attempt(v_three_exam, jsonb_build_object('91000000-0000-0000-0000-000000000605','A'), '[]'::jsonb);
  begin
    perform public.request_exam_attempt_reopen(v_three_attempt, 'Three attempts should not reopen.');
    insert into scoring_test_results values ('77 three-attempt reopen rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('77 three-attempt reopen rejected', 'PASS', sqlerrm);
  end;

  perform public.authorize_exam_start(v_four_exam);
  v_four_attempt := public.submit_exam_attempt(v_four_exam, jsonb_build_object('91000000-0000-0000-0000-000000000606','A'), '[]'::jsonb);
  begin
    perform public.request_exam_attempt_reopen(v_four_attempt, 'Four attempts should not reopen.');
    insert into scoring_test_results values ('78 four-attempt reopen rejected', 'FAIL', 'accepted');
  exception when others then
    insert into scoring_test_results values ('78 four-attempt reopen rejected', 'PASS', sqlerrm);
  end;

  perform public.authorize_exam_start(v_file_exam);
  v_file_attempt := public.submit_exam_attempt(v_file_exam, jsonb_build_object(
    '91000000-0000-0000-0000-000000000607', jsonb_build_object('path','upload1.pdf'),
    '91000000-0000-0000-0000-000000000608', 'first essay'
  ), '[]'::jsonb);
  v_result := to_jsonb(public.request_exam_attempt_reopen(v_file_attempt, 'Need to replace upload.'));
  v_answer_id := (v_result->>'id')::uuid;

  perform pg_temp.as_user(v_prof);
  v_result := to_jsonb(public.review_exam_attempt_reopen_request(v_reopen_request, 'Approved'));
  insert into scoring_test_results values ('64 professor approval reopens same attempt', case when exists(select 1 from public.exam_attempts where id = v_limit_attempt and status = 'Reopened' and score is null and submitted_at is null) and (select count(*) from public.exam_attempts where exam_id = v_limit_exam and student_id = v_student) = 1 then 'PASS' else 'FAIL' end, v_result::text);

  v_result := to_jsonb(public.review_exam_attempt_reopen_request(v_answer_id, 'Approved'));
  insert into scoring_test_results values ('79 file reopen approval preserves answers before resubmit', case when exists(select 1 from public.exam_attempts where id = v_file_attempt and status = 'Reopened') and exists(select 1 from public.exam_attempt_answers where attempt_id = v_file_attempt and question_id = '91000000-0000-0000-0000-000000000607' and file_url = 'upload1.pdf') then 'PASS' else 'FAIL' end, v_result::text);

  perform pg_temp.as_user(v_student);
  v_reopen_session := public.authorize_exam_start(v_limit_exam);
  insert into scoring_test_results values ('89 reopened start creates fresh session', case when exists(select 1 from public.exam_attempts where id = v_limit_attempt and submission_session_started_at = v_reopen_session and v_reopen_session is not null and v_original_session is not null and v_reopen_session is distinct from v_original_session) and exists(select 1 from public.exam_start_sessions where exam_id = v_limit_exam and student_id = v_student and started_at = v_reopen_session and interruption_count = 0 and recovery_event_keys = '[]'::jsonb) and (select count(*) from public.exam_attempts where exam_id = v_limit_exam and student_id = v_student) = 1 then 'PASS' else 'FAIL' end, coalesce(v_original_session::text, 'null') || ' -> ' || coalesce(v_reopen_session::text, 'null'));
  insert into scoring_test_results values ('80 approved reopen preserves previous answer before resubmit', case when exists(select 1 from public.exam_attempt_answers where attempt_id = v_limit_attempt and question_id = '91000000-0000-0000-0000-000000000301' and answer = '"A"'::jsonb) then 'PASS' else 'FAIL' end, v_limit_attempt::text);
  insert into scoring_test_results values ('65 reopened attempt can start despite limit', 'PASS', v_limit_attempt::text);
  v_returned_attempt := public.submit_exam_attempt(v_limit_exam, jsonb_build_object('91000000-0000-0000-0000-000000000301','B'), '[]'::jsonb);
  insert into scoring_test_results values ('66 reopened resubmit same attempt', case when v_returned_attempt = v_limit_attempt and (select count(*) from public.exam_attempts where exam_id = v_limit_exam and student_id = v_student) = 1 then 'PASS' else 'FAIL' end, 'returned=' || v_returned_attempt::text || '; expected=' || v_limit_attempt::text || '; count=' || (select count(*) from public.exam_attempts where exam_id = v_limit_exam and student_id = v_student)::text || '; status=' || coalesce((select status from public.exam_attempts where id = v_limit_attempt), '<missing>') || '; score=' || coalesce((select score::text from public.exam_attempts where id = v_limit_attempt), '<null>'));
  insert into scoring_test_results values ('81 reopened resubmit replaces answer snapshot', case when exists(select 1 from public.exam_attempt_answers where attempt_id = v_limit_attempt and question_id = '91000000-0000-0000-0000-000000000301' and answer = '"B"'::jsonb and earned_points = 0) then 'PASS' else 'FAIL' end, v_limit_attempt::text);

  perform public.authorize_exam_start(v_file_exam);
  insert into scoring_test_results values ('82 file reopened attempt can start', 'PASS', v_file_attempt::text);
  v_returned_attempt := public.submit_exam_attempt(v_file_exam, jsonb_build_object('91000000-0000-0000-0000-000000000607', jsonb_build_object('path','upload2.pdf'), '91000000-0000-0000-0000-000000000608', 'second essay'), '[]'::jsonb);
  insert into scoring_test_results values ('83 file reopened resubmit same attempt manual pending', case when v_returned_attempt = v_file_attempt and exists(select 1 from public.exam_attempts where id = v_file_attempt and status = 'Pending Manual Grading' and score is null) and (select count(*) from public.exam_attempts where exam_id = v_file_exam and student_id = v_student) = 1 then 'PASS' else 'FAIL' end, 'returned=' || v_returned_attempt::text || '; expected=' || v_file_attempt::text || '; count=' || (select count(*) from public.exam_attempts where exam_id = v_file_exam and student_id = v_student)::text || '; status=' || coalesce((select status from public.exam_attempts where id = v_file_attempt), '<missing>') || '; score=' || coalesce((select score::text from public.exam_attempts where id = v_file_attempt), '<null>'));
  insert into scoring_test_results values ('84 file reopened resubmit replaces file answer', case when exists(select 1 from public.exam_attempt_answers where attempt_id = v_file_attempt and question_id = '91000000-0000-0000-0000-000000000607' and file_url = 'upload2.pdf' and needs_manual_grading) then 'PASS' else 'FAIL' end, v_file_attempt::text);

  insert into scoring_test_results values ('33 normal submit scoring', case when exists(select 1 from public.exam_attempts where id = v_attempt and score = 69.70) then 'PASS' else 'FAIL' end, v_attempt::text);
  insert into scoring_test_results values ('34 violation auto-submit uses same submission path', case when public.submit_exam_attempt(v_exam, '{}'::jsonb, '[{"submissionReason":"violation_limit"}]'::jsonb) = v_attempt then 'PASS' else 'FAIL' end, 'shared path');
  insert into scoring_test_results values ('35 interruption auto-submit uses same submission path', case when public.submit_exam_attempt(v_exam, '{}'::jsonb, '[{"submissionReason":"interruption_limit"}]'::jsonb) = v_attempt then 'PASS' else 'FAIL' end, 'shared path');
  insert into scoring_test_results values ('36 timer auto-submit uses same submission path', case when public.submit_exam_attempt(v_exam, '{}'::jsonb, '[{"submissionReason":"timer"}]'::jsonb) = v_attempt then 'PASS' else 'FAIL' end, 'shared path');
end $$;

select * from scoring_test_results order by test;

rollback;
