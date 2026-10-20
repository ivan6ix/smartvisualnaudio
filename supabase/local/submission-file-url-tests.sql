set client_min_messages = warning;

begin;

create temp table file_url_test_results (
  test text not null,
  status text not null,
  observed text not null
) on commit drop;

grant select, insert on file_url_test_results to authenticated, anon;

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
  v_prof uuid := '93000000-0000-0000-0000-000000000001';
  v_student uuid := '93000000-0000-0000-0000-000000000002';
  v_other_prof uuid := '93000000-0000-0000-0000-000000000003';
  v_other_student uuid := '93000000-0000-0000-0000-000000000004';
  v_program uuid := '93000000-0000-0000-0000-000000000005';
  v_course uuid := '93000000-0000-0000-0000-000000000006';
  v_exam uuid := '93000000-0000-0000-0000-000000000007';
  q_valid uuid := '93000000-0000-0000-0000-000000000101';
  q_other_student uuid := '93000000-0000-0000-0000-000000000102';
  q_missing uuid := '93000000-0000-0000-0000-000000000103';
  q_wrong_question uuid := '93000000-0000-0000-0000-000000000104';
  q_essay uuid := '93000000-0000-0000-0000-000000000105';
  q_string uuid := '93000000-0000-0000-0000-000000000106';
  p_valid text;
  p_other_student text;
  p_missing text;
  p_wrong_question text;
  p_essay text;
  v_attempt uuid;
  v_returned uuid;
  v_request uuid;
  v_result jsonb;
  v_count int;
begin
  perform pg_temp.as_service();

  -- Function metadata: security definer, fixed search_path, authenticated-only execution, no stale fileUrl key.
  insert into file_url_test_results values ('01 submit_exam_attempt keeps definer and search_path',
    case when exists (select 1 from pg_proc where oid = 'public.submit_exam_attempt(uuid,jsonb,jsonb)'::regprocedure and prosecdef and proconfig = array['search_path=public']) then 'PASS' else 'FAIL' end,
    coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = 'public.submit_exam_attempt(uuid,jsonb,jsonb)'::regprocedure), '<none>'));
  insert into file_url_test_results values ('02 submit_exam_attempt execute grants',
    case when has_function_privilege('authenticated', 'public.submit_exam_attempt(uuid,jsonb,jsonb)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.submit_exam_attempt(uuid,jsonb,jsonb)', 'EXECUTE')
      and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.submit_exam_attempt(uuid,jsonb,jsonb)'::regprocedure and a.grantee = 0)
    then 'PASS' else 'FAIL' end, 'authenticated only');
  insert into file_url_test_results values ('03 stale fileUrl key removed',
    case when (select prosrc from pg_proc where oid = 'public.submit_exam_attempt(uuid,jsonb,jsonb)'::regprocedure) not like '%fileUrl%' then 'PASS' else 'FAIL' end, 'prosrc');
  insert into file_url_test_results values ('04 audit trigger ignores file_url',
    case when (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'audit_manual_grading_changes' and tgrelid = 'public.exam_attempt_answers'::regclass) not like '%file_url%' then 'PASS' else 'FAIL' end, 'trigger columns');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_prof, 'fileurl-prof@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_student, 'fileurl-student@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_other_prof, 'fileurl-other-prof@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
    (v_other_student, 'fileurl-other-student@example.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated');

  insert into public.profiles (id, role, full_name, email, employee_number, student_number, status)
  values
    (v_prof, 'Professor', 'File URL Professor', 'fileurl-prof@example.test', 'FU-1', null, 'Active'),
    (v_student, 'Student', 'File URL Student', 'fileurl-student@example.test', null, 'FUS-1', 'Active'),
    (v_other_prof, 'Professor', 'File URL Other Professor', 'fileurl-other-prof@example.test', 'FU-2', null, 'Active'),
    (v_other_student, 'Student', 'File URL Other Student', 'fileurl-other-student@example.test', null, 'FUS-2', 'Active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  insert into public.programs (id, program_code, program_name, is_active) values (v_program, 'FUT', 'File URL Test', true);
  insert into public.courses (id, course_name, course_code, section, professor_id, program_id, joining_code, archived)
  values (v_course, 'File URL Course', 'FUT101', 'A', v_prof, v_program, 'FUT-JOIN', false);
  insert into public.course_enrollments (course_id, student_id) values (v_course, v_student), (v_course, v_other_student);

  insert into public.exams (id, course_id, title, exam_title, description, course, professor_id, time_limit, exam_type, semester, exam_settings, questions_count, duration, created_by, status, approved_at)
  values (v_exam, v_course, 'File URL Exam', 'File URL Exam', 'Runtime', 'FUT101', v_prof, 60, 'Quiz', '1st', '{"startsAt":"2000-01-01T00:00:00Z","deadline":"2999-01-01T00:00:00Z","attemptLimit":"1 attempt","archived":false}'::jsonb, 6, 60, v_prof, 'Draft', null);
  insert into public.exam_questions (id, exam_id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points)
  values
    (q_valid, v_exam, 'Valid upload', 'File Upload', '[]', '', '[]', '{}', true, 5),
    (q_other_student, v_exam, 'Other student path', 'File Upload', '[]', '', '[]', '{}', true, 5),
    (q_missing, v_exam, 'Missing object', 'File Upload', '[]', '', '[]', '{}', true, 5),
    (q_wrong_question, v_exam, 'Wrong question folder', 'File Upload', '[]', '', '[]', '{}', true, 5),
    (q_essay, v_exam, 'Essay with path', 'Essay', '[]', '', '[]', '{}', true, 5),
    (q_string, v_exam, 'String answer', 'File Upload', '[]', '', '[]', '{}', true, 5);
  update public.exams set status = 'Published', approved_at = now() where id = v_exam;

  p_valid := v_student || '/' || v_exam || '/' || q_valid || '/1-valid.pdf';
  p_other_student := v_other_student || '/' || v_exam || '/' || q_other_student || '/1-other.pdf';
  p_missing := v_student || '/' || v_exam || '/' || q_missing || '/1-missing.pdf';
  p_wrong_question := v_student || '/' || v_exam || '/' || q_valid || '/2-wrong-question.pdf';
  p_essay := v_student || '/' || v_exam || '/' || q_essay || '/1-essay.pdf';
  insert into storage.objects (bucket_id, name, owner_id)
  values
    ('exam-submissions', p_valid, v_student::text),
    ('exam-submissions', p_other_student, v_other_student::text),
    ('exam-submissions', p_wrong_question, v_student::text),
    ('exam-submissions', p_essay, v_student::text);

  -- Student submits one attempt covering valid and spoofed paths.
  perform pg_temp.as_user(v_student);
  perform public.authorize_exam_start(v_exam);
  v_attempt := public.submit_exam_attempt(v_exam, jsonb_build_object(
    q_valid::text, jsonb_build_object('fileName', 'valid.pdf', 'path', p_valid),
    q_other_student::text, jsonb_build_object('fileName', 'other.pdf', 'path', p_other_student),
    q_missing::text, jsonb_build_object('fileName', 'missing.pdf', 'path', p_missing),
    q_wrong_question::text, jsonb_build_object('fileName', 'wrong.pdf', 'path', p_wrong_question),
    q_essay::text, jsonb_build_object('path', p_essay),
    q_string::text, to_jsonb(p_valid)
  ), '[]'::jsonb);

  perform pg_temp.as_service();
  insert into file_url_test_results values ('10 valid own upload records file_url',
    case when exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_valid and file_url = p_valid and needs_manual_grading) then 'PASS' else 'FAIL' end,
    coalesce((select file_url from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_valid), '<null>'));
  insert into file_url_test_results values ('11 another student''s path is not recorded',
    case when exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_other_student and file_url is null and answer->>'path' = p_other_student) then 'PASS' else 'FAIL' end, 'answer kept, file_url null');
  insert into file_url_test_results values ('12 path without a storage object is not recorded',
    case when exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_missing and file_url is null) then 'PASS' else 'FAIL' end, 'missing object');
  insert into file_url_test_results values ('13 path from another question folder is not recorded',
    case when exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_wrong_question and file_url is null) then 'PASS' else 'FAIL' end, 'wrong question');
  insert into file_url_test_results values ('14 non-File Upload answer is not recorded',
    case when exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_essay and file_url is null) then 'PASS' else 'FAIL' end, 'essay');
  insert into file_url_test_results values ('15 non-object File Upload answer is not recorded',
    case when exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_string and file_url is null) then 'PASS' else 'FAIL' end, 'string answer');

  -- Storage read access follows file_url.
  perform pg_temp.as_user(v_prof);
  select count(*) into v_count from storage.objects where bucket_id = 'exam-submissions' and name = p_valid;
  insert into file_url_test_results values ('20 owning professor can read the submitted file', case when v_count = 1 then 'PASS' else 'FAIL' end, v_count::text);
  select count(*) into v_count from storage.objects where bucket_id = 'exam-submissions' and name in (p_other_student, p_wrong_question, p_essay);
  insert into file_url_test_results values ('21 owning professor cannot read unrecorded files', case when v_count = 0 then 'PASS' else 'FAIL' end, v_count::text);
  perform pg_temp.as_user(v_other_prof);
  select count(*) into v_count from storage.objects where bucket_id = 'exam-submissions' and name = p_valid;
  insert into file_url_test_results values ('22 other professor cannot read the file', case when v_count = 0 then 'PASS' else 'FAIL' end, v_count::text);
  perform pg_temp.as_user(v_other_student);
  select count(*) into v_count from storage.objects where bucket_id = 'exam-submissions' and name = p_valid;
  insert into file_url_test_results values ('23 other student cannot read the file', case when v_count = 0 then 'PASS' else 'FAIL' end, v_count::text);
  perform pg_temp.as_user(v_student);
  select count(*) into v_count from storage.objects where bucket_id = 'exam-submissions' and name = p_valid;
  insert into file_url_test_results values ('24 student can still read own file', case when v_count = 1 then 'PASS' else 'FAIL' end, v_count::text);
  perform pg_temp.as_anon();
  select count(*) into v_count from storage.objects where bucket_id = 'exam-submissions' and name = p_valid;
  insert into file_url_test_results values ('25 anon cannot read the file', case when v_count = 0 then 'PASS' else 'FAIL' end, v_count::text);

  -- Reopened attempt: the restored path from the previous upload is recorded again on resubmit.
  perform pg_temp.as_user(v_student);
  v_result := to_jsonb(public.request_exam_attempt_reopen(v_attempt, 'Need to replace upload.'));
  v_request := (v_result->>'id')::uuid;
  perform pg_temp.as_user(v_prof);
  perform public.review_exam_attempt_reopen_request(v_request, 'Approved');
  perform pg_temp.as_service();
  insert into file_url_test_results values ('30 reopen approval keeps file_url',
    case when exists (select 1 from public.exam_attempts where id = v_attempt and status = 'Reopened')
      and exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_valid and file_url = p_valid) then 'PASS' else 'FAIL' end, v_result::text);
  perform pg_temp.as_user(v_student);
  perform public.authorize_exam_start(v_exam);
  v_returned := public.submit_exam_attempt(v_exam, jsonb_build_object(
    q_valid::text, jsonb_build_object('fileName', 'valid.pdf', 'path', p_valid)
  ), '[]'::jsonb);
  perform pg_temp.as_service();
  insert into file_url_test_results values ('31 reopened resubmit records restored path',
    case when v_returned = v_attempt and exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_valid and file_url = p_valid) then 'PASS' else 'FAIL' end,
    'returned=' || coalesce(v_returned::text, '<null>'));

  -- Backfill: the migration statement, limited to this attempt so other local rows are not counted.
  update public.exam_attempt_answers set file_url = null where attempt_id = v_attempt;
  update public.exam_attempt_answers set answer = jsonb_build_object('fileName', 'other.pdf', 'path', p_other_student) where attempt_id = v_attempt and question_id = q_other_student;
  update public.exam_attempt_answers aa
  set file_url = aa.answer->>'path'
  from public.exam_attempts a, public.exam_questions q
  where a.id = aa.attempt_id
    and q.id = aa.question_id
    and q.exam_id = a.exam_id
    and q.question_type = 'File Upload'
    and nullif(aa.file_url, '') is null
    and jsonb_typeof(aa.answer) = 'object'
    and nullif(aa.answer->>'path', '') is not null
    and starts_with(aa.answer->>'path', a.student_id::text || '/' || a.exam_id::text || '/' || q.id::text || '/')
    and exists (select 1 from storage.objects o where o.bucket_id = 'exam-submissions' and o.name = aa.answer->>'path')
    and aa.attempt_id = v_attempt;
  get diagnostics v_count = row_count;
  insert into file_url_test_results values ('40 backfill restores only the valid path',
    case when v_count = 1
      and exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id = q_valid and file_url = p_valid)
      and not exists (select 1 from public.exam_attempt_answers where attempt_id = v_attempt and question_id <> q_valid and file_url is not null)
    then 'PASS' else 'FAIL' end, 'updated=' || v_count);
  update public.exam_attempt_answers aa
  set file_url = aa.answer->>'path'
  from public.exam_attempts a, public.exam_questions q
  where a.id = aa.attempt_id
    and q.id = aa.question_id
    and q.exam_id = a.exam_id
    and q.question_type = 'File Upload'
    and nullif(aa.file_url, '') is null
    and jsonb_typeof(aa.answer) = 'object'
    and nullif(aa.answer->>'path', '') is not null
    and starts_with(aa.answer->>'path', a.student_id::text || '/' || a.exam_id::text || '/' || q.id::text || '/')
    and exists (select 1 from storage.objects o where o.bucket_id = 'exam-submissions' and o.name = aa.answer->>'path')
    and aa.attempt_id = v_attempt;
  get diagnostics v_count = row_count;
  insert into file_url_test_results values ('41 backfill is idempotent', case when v_count = 0 then 'PASS' else 'FAIL' end, 'updated=' || v_count);
end $$;

select * from file_url_test_results order by test;
select count(*) filter (where status = 'PASS') as passed, count(*) filter (where status <> 'PASS') as failed from file_url_test_results;

rollback;
