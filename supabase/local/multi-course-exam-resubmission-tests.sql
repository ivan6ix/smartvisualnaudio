begin;

do $$
declare
  professor_id uuid := gen_random_uuid();
  other_professor uuid := gen_random_uuid();
  cluster_id uuid := gen_random_uuid();
  course_a uuid := gen_random_uuid();
  course_b uuid := gen_random_uuid();
  request jsonb;
  v_group uuid;
  first_exam uuid;
  rev bigint;
  old_submitted timestamptz;
  blocked boolean;
  message text;
  questions jsonb := '[{"question_text":"Resubmit one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2}]';
begin
  if position('''rejected''' in lower(pg_get_functiondef('public.transition_exam_group(uuid,text,bigint)'::regprocedure))) = 0 then
    raise exception 'Rejected resubmission migration is missing';
  end if;

  insert into auth.users(id, email) values
    (professor_id, 'resubmit-professor@example.invalid'),
    (other_professor, 'resubmit-other@example.invalid'),
    (cluster_id, 'resubmit-cluster@example.invalid');
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'Resubmit Professor' where id = professor_id;
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'Resubmit Other' where id = other_professor;
  update public.profiles set role = 'Cluster Professor', status = 'Active', full_name = 'Resubmit Cluster' where id = cluster_id;
  insert into public.courses(id, course_name, course_code, section, joining_code, professor_id, archived) values
    (course_a, 'Resubmit A', 'RSA', 'A', 'RSA-' || course_a::text, professor_id, false),
    (course_b, 'Resubmit B', 'RSB', 'B', 'RSB-' || course_b::text, professor_id, false);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Submit, then reject the shared exam.
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.publish_exam_group(null,
    jsonb_build_object('title', 'Resubmit Group', 'status', 'Pending Review', 'duration', 30,
      'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    questions, array[course_a, course_b], '{}'::jsonb, 'resubmit-key');
  v_group := (request->>'group_id')::uuid;
  select m.exam_id into first_exam from public.exam_publish_group_members m where m.group_id = v_group and m.course_id = course_a;
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(first_exam, 'reject', 'Clarify question one.');
  rev := (request->>'revision')::bigint;
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.status = 'Rejected' and e.rejected_at is not null) <> 2 then
    raise exception 'Setup: group was not rejected on every member';
  end if;
  select max(e.submitted_at) into old_submitted from public.exams e
  join public.exam_publish_group_members m on m.exam_id = e.id where m.group_id = v_group;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);

  -- Another professor cannot resubmit the group.
  blocked := false;
  begin
    perform set_config('request.jwt.claim.sub', other_professor::text, true);
    perform public.transition_exam_group(v_group, 'submit_review', rev);
  exception when others then blocked := true; message := sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  if not blocked or message not like '%Group access denied%' then raise exception 'Another professor resubmitted the group'; end if;

  -- A stale revision is refused.
  blocked := false;
  begin
    perform public.transition_exam_group(v_group, 'submit_review', rev - 1);
  exception when serialization_failure then blocked := true;
  end;
  if not blocked then raise exception 'Stale revision resubmitted the group'; end if;

  -- A rejected group still cannot be published directly.
  blocked := false;
  begin
    perform public.transition_exam_group(v_group, 'publish', rev);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Rejected group published without review'; end if;

  -- A diverged member blocks resubmission without partial changes.
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id) values (txid_current(), pg_backend_pid(), v_group);
  update public.exam_questions set points = points + 1 where exam_id = first_exam;
  delete from exam_private.group_write_context where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = v_group;
  blocked := false;
  begin
    perform public.transition_exam_group(v_group, 'submit_review', rev);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Diverged group was resubmitted'; end if;
  if exists (select 1 from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
             where m.group_id = v_group and e.status <> 'Rejected')
     or (select revision from public.exam_publish_groups where id = v_group) <> rev then
    raise exception 'Failed resubmission partially updated the group';
  end if;
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id) values (txid_current(), pg_backend_pid(), v_group);
  update public.exam_questions set points = points - 1 where exam_id = first_exam;
  delete from exam_private.group_write_context where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = v_group;

  -- Rejected -> Pending Review without editing.
  request := public.transition_exam_group(v_group, 'submit_review', rev);
  rev := (request->>'revision')::bigint;
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.status = 'Pending Review' and e.rejected_at is null
        and e.approved_at is null and e.submitted_at >= old_submitted) <> 2 then
    raise exception 'Rejected group was not resubmitted on every member';
  end if;
  if (select count(*) from public.exam_reviews r join public.exam_publish_group_members m on m.exam_id = r.exam_id
      where m.group_id = v_group and r.decision = 'Rejected' and r.remarks = 'Clarify question one.') <> 2 then
    raise exception 'Rejection history was not preserved';
  end if;
  if (select count(*) from public.logs l join public.exam_publish_group_members m on m.exam_id = l.entity_id
      where m.group_id = v_group and l.event_type = 'exam.rejected') < 2 then
    raise exception 'Rejection audit logs were not preserved';
  end if;

  -- Pending Review cannot be resubmitted again.
  blocked := false;
  begin
    perform public.transition_exam_group(v_group, 'submit_review', rev);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Pending group was resubmitted twice'; end if;

  -- Cluster can reject the resubmission again, then the professor resubmits and it is approved and published.
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(first_exam, 'reject', 'Still unclear.');
  rev := (request->>'revision')::bigint;
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.status = 'Rejected') <> 2 then
    raise exception 'Cluster could not reject the resubmission';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(v_group, 'submit_review', rev);
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(first_exam, 'approve', 'Approved for publishing.');
  rev := (request->>'revision')::bigint;
  if (select count(*) from public.exam_reviews r join public.exam_publish_group_members m on m.exam_id = r.exam_id
      where m.group_id = v_group) <> 6 then
    raise exception 'Expected two rejections and one approval per member';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(v_group, 'publish', rev);
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.status = 'Published' and e.approved_at is not null) <> 2 then
    raise exception 'Approved resubmission did not publish on every member';
  end if;

  -- Archived rejected groups still cannot be resubmitted.
  request := public.publish_exam_group(null,
    jsonb_build_object('title', 'Archived Reject', 'status', 'Pending Review', 'duration', 30,
      'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    questions, array[course_a, course_b], '{}'::jsonb, 'archived-reject-key');
  v_group := (request->>'group_id')::uuid;
  select m.exam_id into first_exam from public.exam_publish_group_members m where m.group_id = v_group limit 1;
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(first_exam, 'reject', 'Archive me.');
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(v_group, 'archive', (request->>'revision')::bigint);
  blocked := false;
  begin
    perform public.transition_exam_group(v_group, 'submit_review', (request->>'revision')::bigint);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Archived rejected group was resubmitted'; end if;
end;
$$;

rollback;
