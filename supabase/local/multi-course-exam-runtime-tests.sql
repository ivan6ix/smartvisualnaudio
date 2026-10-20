begin;

do $$
declare
  professor_id uuid := gen_random_uuid();
  student_a uuid := gen_random_uuid();
  student_b uuid := gen_random_uuid();
  cluster_id uuid := gen_random_uuid();
  other_professor uuid := gen_random_uuid();
  course_a uuid := gen_random_uuid();
  course_b uuid := gen_random_uuid();
  course_c uuid := gen_random_uuid();
  course_d uuid := gen_random_uuid();
  request jsonb;
  repeated jsonb;
  member_count integer;
  conflict_seen boolean := false;
  blocked boolean := false;
  first_exam uuid;
  review_group uuid;
  review_exam uuid;
  legacy_exam uuid;
  draft_exam uuid;
begin
  if to_regclass('public.exam_publish_groups') is null
     or to_regclass('public.exam_publish_group_members') is null then
    raise exception 'Multi-course group schema is missing';
  end if;
  if to_regprocedure('public.publish_exam_group(uuid,jsonb,jsonb,uuid[],jsonb,text)') is null then
    raise exception 'Atomic publish RPC is missing';
  end if;
  if to_regprocedure('public.save_exam_group(uuid,jsonb,jsonb,jsonb,bigint)') is null
     or to_regprocedure('public.transition_exam_group(uuid,text,bigint)') is null then
    raise exception 'Shared edit or lifecycle RPC is missing';
  end if;
  if to_regprocedure('public.review_exam_group(uuid,text,text)') is null then
    raise exception 'Atomic Cluster review RPC is missing';
  end if;
  if position('order by q.sort_order nulls last, q.id' in
      lower(pg_get_functiondef('public.get_student_exam_questions(uuid)'::regprocedure))) = 0 then
    raise exception 'Student questions do not use authored group order';
  end if;

  insert into auth.users(id, email) values
    (professor_id, 'group-test-professor@example.invalid'),
    (student_a, 'group-test-a@example.invalid'),
    (student_b, 'group-test-b@example.invalid'),
    (cluster_id, 'group-test-cluster@example.invalid'),
    (other_professor, 'group-test-other@example.invalid');
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'Group Test Professor'
  where id = professor_id;
  update public.profiles set role = 'Student', status = 'Active', full_name = 'Group Test Student'
  where id in (student_a, student_b);
  update public.profiles set role = 'Cluster Professor', status = 'Active', full_name = 'Group Test Cluster'
  where id = cluster_id;
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'Other Professor'
  where id = other_professor;
  insert into public.courses(id, course_name, course_code, section, joining_code, professor_id, archived) values
    (course_a, 'Group Test A', 'GTA', 'A', 'GTA-' || course_a::text, professor_id, false),
    (course_b, 'Group Test B', 'GTB', 'B', 'GTB-' || course_b::text, professor_id, false),
    (course_c, 'Group Test C', 'GTC', 'C', 'GTC-' || course_c::text, professor_id, false),
    (course_d, 'Other Course', 'GTD', 'D', 'GTD-' || course_d::text, other_professor, false);
  insert into public.course_enrollments(course_id, student_id) values
    (course_a, student_a), (course_b, student_b), (course_c, student_a);
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  request := public.publish_exam_group(
    null,
    jsonb_build_object('title', 'Group Test', 'status', 'Published',
      'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
    '[{"question_text":"Question one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2},{"question_text":"Question two?","question_type":"multiple_choice","choices":["Yes","No"],"correct_answer":"Yes","correct_answers":[],"question_config":{},"manual_grading":false,"points":3}]'::jsonb,
    array[course_a, course_b, course_c],
    jsonb_build_object(course_a::text, jsonb_build_array(student_a),
      course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_a)),
    'group-test-key'
  );
  select count(*) into member_count from public.exam_publish_group_members
  where group_id = (request->>'group_id')::uuid;
  if member_count <> 3 then
    raise exception 'Expected three group members, got %', member_count;
  end if;
  if (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid and e.status = 'Published'
        and e.assignment_mode = 'selected_students') <> 3 then
    raise exception 'Each course must have an independent published exam';
  end if;
  if (select count(*) from public.exam_student_assignments a
      join public.exam_publish_group_members m on m.exam_id = a.exam_id
      where m.group_id = (request->>'group_id')::uuid) <> 3 then
    raise exception 'Expected separate per-course assignments';
  end if;
  if (select count(*) from public.notifications n
      join public.exam_publish_group_members m on m.exam_id = n.entity_id
      where m.group_id = (request->>'group_id')::uuid and n.title = 'Exam Available') <> 3 then
    raise exception 'Selected students did not receive per-course publication notices';
  end if;
  if exists (
    select 1 from public.exam_student_assignments a
    join public.exam_publish_group_members m on m.exam_id = a.exam_id
    left join public.course_enrollments ce on ce.course_id = m.course_id and ce.student_id = a.student_id
    where m.group_id = (request->>'group_id')::uuid and ce.student_id is null
  ) then
    raise exception 'Assignment crossed a course boundary';
  end if;
  if (select count(distinct q.id) from public.exam_questions q
      join public.exam_publish_group_members m on m.exam_id = q.exam_id
      where m.group_id = (request->>'group_id')::uuid) <> 6 then
    raise exception 'Question IDs must be distinct per member';
  end if;
  if exists (
    select 1 from public.exam_publish_group_members m
    join public.exam_questions q on q.exam_id = m.exam_id
    where m.group_id = (request->>'group_id')::uuid and q.sort_order not in (1, 2)
  ) then
    raise exception 'Question order was not retained';
  end if;

  repeated := public.publish_exam_group(
    null,
    jsonb_build_object('title', 'Group Test', 'status', 'Published',
      'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
    '[{"question_text":"Question one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2},{"question_text":"Question two?","question_type":"multiple_choice","choices":["Yes","No"],"correct_answer":"Yes","correct_answers":[],"question_config":{},"manual_grading":false,"points":3}]'::jsonb,
    array[course_c, course_b, course_a],
    jsonb_build_object(course_a::text, jsonb_build_array(student_a),
      course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_a)),
    'group-test-key'
  );
  if repeated <> request then
    raise exception 'Idempotent replay changed the result';
  end if;
  begin
    perform public.publish_exam_group(null,
      jsonb_build_object('title', 'Changed', 'status', 'Published', 'duration', 45,
        'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
      '[{"question_text":"Changed?","points":1}]'::jsonb,
      array[course_a, course_b, course_c],
      jsonb_build_object(course_a::text, jsonb_build_array(student_a),
        course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_a)),
      'group-test-key');
  exception when unique_violation then conflict_seen := true;
  end;
  if not conflict_seen then
    raise exception 'Changed payload reused an idempotency key';
  end if;

  begin
    perform public.publish_exam_group(null,
      jsonb_build_object('title', 'Invalid Assignments', 'status', 'Published',
        'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
      '[{"question_text":"Question?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2}]'::jsonb,
      array[course_a, course_b],
      jsonb_build_object(course_a::text, jsonb_build_array(student_a),
        course_b::text, jsonb_build_array(student_a)),
      'invalid-student-key');
  exception when others then blocked := true;
  end;
  if not blocked or exists (select 1 from public.exam_publish_groups where request_key = 'invalid-student-key') then
    raise exception 'Invalid per-course student did not roll back the group';
  end if;
  blocked := false;
  begin
    perform public.publish_exam_group(null,
      jsonb_build_object('title', 'Unauthorized Course', 'status', 'Published',
        'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
      '[{"question_text":"Question?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2}]'::jsonb,
      array[course_a, course_d], '{}'::jsonb, 'unauthorized-course-key');
  exception when others then blocked := true;
  end;
  if not blocked or exists (select 1 from public.exam_publish_groups where request_key = 'unauthorized-course-key') then
    raise exception 'Unauthorized destination did not roll back the group';
  end if;

  select exam_id into first_exam from public.exam_publish_group_members
  where group_id = (request->>'group_id')::uuid and course_id = course_a;
  perform set_config('request.jwt.claim.sub', student_a::text, true);
  if not public.student_can_take_exam(first_exam) then
    raise exception 'Assigned student cannot access their course exam';
  end if;
  if public.student_can_take_exam((select exam_id from public.exam_publish_group_members
      where group_id = (request->>'group_id')::uuid and course_id = course_b)) then
    raise exception 'Student gained access to another course exam';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  perform public.save_exam_assignments(first_exam, 'selected_students', array[student_a]);
  blocked := false;
  begin
    perform public.save_exam_assignments(first_exam, 'entire_course', '{}'::uuid[]);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Per-member assignment mode changed outside group RPC'; end if;
  blocked := false;
  begin
    update public.exams set title = 'Single member mutation' where id = first_exam;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Direct grouped-member edit was allowed'; end if;
  blocked := false;
  begin
    update public.exams set status = 'Unpublished' where id = first_exam;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Direct grouped-member status change was allowed'; end if;

  request := public.transition_exam_group((request->>'group_id')::uuid, 'unpublish', 1);
  if (request->>'revision')::bigint <> 2 then raise exception 'Lifecycle revision was not incremented'; end if;
  blocked := false;
  begin
    update public.exam_questions set points = points + 1 where exam_id = first_exam;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Direct grouped-member question edit was allowed'; end if;
  blocked := false;
  begin
    perform public.save_exam_group((request->>'group_id')::uuid,
      jsonb_build_object('title', 'Partial Rewrite', 'duration', 45,
        'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
      '[{"question_text":"Changed?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":1}]'::jsonb,
      jsonb_build_object(course_a::text, jsonb_build_array(student_a),
        course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_b)), 2);
  exception when others then blocked := true;
  end;
  if not blocked or exists (select 1 from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid and e.title = 'Partial Rewrite')
      or (select revision from public.exam_publish_groups where id = (request->>'group_id')::uuid) <> 2 then
    raise exception 'Failed group edit did not roll back all members';
  end if;
  request := public.save_exam_group(
    (request->>'group_id')::uuid,
    jsonb_build_object('title', 'Group Revised', 'duration', 45,
      'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
    '[{"question_text":"Revised one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"B","correct_answers":[],"question_config":{},"manual_grading":false,"points":2},{"question_text":"Revised two?","question_type":"multiple_choice","choices":["Yes","No"],"correct_answer":"No","correct_answers":[],"question_config":{},"manual_grading":false,"points":3}]'::jsonb,
    jsonb_build_object(course_a::text, jsonb_build_array(student_a),
      course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_a)),
    2
  );
  if (request->>'revision')::bigint <> 3 or (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid and e.title = 'Group Revised') <> 3 then
    raise exception 'Shared edit did not propagate atomically';
  end if;
  blocked := false;
  begin
    perform public.transition_exam_group((request->>'group_id')::uuid, 'publish', 2);
  exception when serialization_failure then blocked := true;
  end;
  if not blocked then raise exception 'Stale revision was accepted'; end if;

  insert into public.exam_start_sessions(exam_id, student_id) values (first_exam, student_a);
  if (select count(*) from public.exam_start_sessions s
      join public.exam_publish_group_members m on m.exam_id = s.exam_id
      where m.group_id = (request->>'group_id')::uuid) <> 1 then
    raise exception 'Student start session leaked into another course exam';
  end if;
  blocked := false;
  begin
    perform public.save_exam_group((request->>'group_id')::uuid,
      jsonb_build_object('title', 'Cannot Rewrite', 'duration', 45,
        'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
      '[{"question_text":"Changed?","points":1}]'::jsonb,
      jsonb_build_object(course_a::text, jsonb_build_array(student_a),
        course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_a)), 3);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Existing start did not protect group content'; end if;
  request := public.transition_exam_group((request->>'group_id')::uuid, 'publish', 3);
  if (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid and e.status = 'Published') <> 3 then
    raise exception 'Group publish did not update every member';
  end if;
  request := public.transition_exam_group((request->>'group_id')::uuid, 'archive', 4);
  if (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid
        and coalesce((e.exam_settings->>'archived')::boolean, false)) <> 3 then
    raise exception 'Archive did not cover every member';
  end if;
  blocked := false;
  begin
    perform public.save_exam_group((request->>'group_id')::uuid,
      jsonb_build_object('title', 'Archived Rewrite', 'duration', 45,
        'exam_settings', '{}'::jsonb, 'assignment_mode', 'selected_students'),
      '[{"question_text":"Changed?","points":1}]'::jsonb,
      jsonb_build_object(course_a::text, jsonb_build_array(student_a),
        course_b::text, jsonb_build_array(student_b), course_c::text, jsonb_build_array(student_a)), 5);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Archived group member was silently edited'; end if;
  request := public.transition_exam_group((request->>'group_id')::uuid, 'restore', 5);
  if (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid
        and coalesce((e.exam_settings->>'archived')::boolean, false)) <> 0 then
    raise exception 'Restore did not cover every member';
  end if;

  request := public.publish_exam_group(null,
    jsonb_build_object('title', 'Review Group', 'status', 'Pending Review',
      'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    '[{"question_text":"Review?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":1}]'::jsonb,
    array[course_a, course_b], '{}'::jsonb, 'review-group-key');
  review_group := (request->>'group_id')::uuid;
  select exam_id into review_exam from public.exam_publish_group_members
  where group_id = review_group limit 1;
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id)
  values (txid_current(), pg_backend_pid(), review_group);
  update public.exam_questions set points = points + 1 where exam_id = review_exam;
  delete from exam_private.group_write_context
  where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = review_group;
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  blocked := false;
  begin
    perform public.review_exam_group(review_exam, 'approve', 'Approved for publishing.');
  exception when others then blocked := true;
  end;
  if not blocked or exists (select 1 from public.exam_reviews r
      join public.exam_publish_group_members m on m.exam_id = r.exam_id
      where m.group_id = review_group) then
    raise exception 'Diverged member did not block the whole group review';
  end if;
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id)
  values (txid_current(), pg_backend_pid(), review_group);
  update public.exam_questions set points = points - 1 where exam_id = review_exam;
  delete from exam_private.group_write_context
  where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = review_group;
  request := public.review_exam_group(review_exam, 'approve', 'Approved for publishing.');
  if (request->>'revision')::bigint <> 2
     or (select count(*) from public.exams e
         join public.exam_publish_group_members m on m.exam_id = e.id
         where m.group_id = review_group and e.status = 'Unpublished' and e.approved_at is not null) <> 2
     or (select count(*) from public.exam_reviews r
         join public.exam_publish_group_members m on m.exam_id = r.exam_id
         where m.group_id = review_group and r.decision = 'Approved') <> 2
     or (select count(*) from public.logs l
         join public.exam_publish_group_members m on m.exam_id = l.entity_id
         where m.group_id = review_group and l.event_type = 'exam.approved') < 2 then
    raise exception 'Cluster decision was not applied to every member';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(review_group, 'publish', 2);
  if (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = review_group and e.status = 'Published') <> 2 then
    raise exception 'Approved group did not publish as one action';
  end if;
  perform set_config('request.jwt.claim.sub', student_a::text, true);
  if not public.student_can_take_exam((select exam_id from public.exam_publish_group_members
      where group_id = review_group and course_id = course_a)) then
    raise exception 'Entire Course member denied its enrolled student';
  end if;
  if public.student_can_take_exam((select exam_id from public.exam_publish_group_members
      where group_id = review_group and course_id = course_b)) then
    raise exception 'Entire Course member exposed another course';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  blocked := false;
  begin
    perform public.publish_exam_group(null,
      jsonb_build_object('title', 'Duplicate Course', 'status', 'Published',
        'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
      '[{"question_text":"Question?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2}]'::jsonb,
      array[course_a, course_a], '{}'::jsonb, 'duplicate-course-key');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Duplicate course IDs were accepted'; end if;

  request := public.publish_exam_group(null,
    jsonb_build_object('title', 'Reject Group', 'status', 'Pending Review',
      'duration', 45, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    '[{"question_text":"Review?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":1}]'::jsonb,
    array[course_a, course_b], '{}'::jsonb, 'reject-group-key');
  review_group := (request->>'group_id')::uuid;
  select exam_id into review_exam from public.exam_publish_group_members
  where group_id = review_group limit 1;
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(review_exam, 'reject', 'Question needs revision.');
  if (select count(*) from public.exams e
      join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = review_group and e.status = 'Rejected' and e.rejected_at is not null) <> 2 then
    raise exception 'Rejection did not cover every group member';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  blocked := false;
  begin
    perform public.transition_exam_group(review_group, 'publish', 2);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Rejected group published without renewed review'; end if;

  legacy_exam := public.save_exam(null,
    jsonb_build_object('course_id', course_a, 'title', 'Legacy Exam',
      'status', 'Unpublished', 'duration', 30, 'exam_settings', '{}'::jsonb),
    '[{"question_text":"Legacy?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":1}]'::jsonb);
  perform public.publish_exam(legacy_exam);
  if exists (select 1 from public.exam_publish_group_members where exam_id = legacy_exam)
     or (select status from public.exams where id = legacy_exam) <> 'Published' then
    raise exception 'Existing single-course exam workflow regressed';
  end if;

  draft_exam := public.save_exam(null,
    jsonb_build_object('course_id', course_a, 'title', 'One Draft', 'status', 'Draft',
      'duration', 30, 'exam_settings', jsonb_build_object('draftSnapshot',
        jsonb_build_object('courseIds', jsonb_build_array(course_a, course_b)))),
    '[]'::jsonb);
  request := public.publish_exam_group(draft_exam,
    jsonb_build_object('title', 'One Draft', 'status', 'Published',
      'duration', 30, 'exam_settings', jsonb_build_object('draftSnapshot',
        jsonb_build_object('courseIds', jsonb_build_array(course_a, course_b))),
      'assignment_mode', 'entire_course'),
    '[{"question_text":"Draft?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":1}]'::jsonb,
    array[course_a, course_b], '{}'::jsonb, 'draft-adoption-key');
  if not exists (select 1 from public.exam_publish_group_members
      where group_id = (request->>'group_id')::uuid and exam_id = draft_exam)
     or (select count(*) from public.exam_publish_group_members
         where group_id = (request->>'group_id')::uuid) <> 2
     or exists (select 1 from public.exams e
         join public.exam_publish_group_members m on m.exam_id = e.id
         where m.group_id = (request->>'group_id')::uuid
           and e.exam_settings ? 'draftSnapshot') then
    raise exception 'Draft was duplicated or its private snapshot leaked to published members';
  end if;

  perform set_config('role', 'authenticated', true);
  if (select count(*) from public.exam_publish_groups where created_by = professor_id) < 3 then
    raise exception 'Professor cannot read their own groups under RLS';
  end if;
  blocked := false;
  begin
    insert into public.exam_publish_groups(created_by, request_key, request_payload, request_digest)
    values (professor_id, 'client-insert', '{}'::jsonb, 'x');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Authenticated client inserted a group directly'; end if;
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  if (select count(*) from public.exam_publish_group_members where group_id = review_group) <> 2 then
    raise exception 'Cluster reviewer cannot see group members under RLS';
  end if;
  perform set_config('request.jwt.claim.sub', student_a::text, true);
  if exists (select 1 from public.exam_publish_groups where created_by = professor_id) then
    raise exception 'Student read a professor group through RLS';
  end if;
  blocked := false;
  begin
    perform public.get_exam_group(first_exam);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Student read group assignments via RPC'; end if;
end;
$$;

rollback;
