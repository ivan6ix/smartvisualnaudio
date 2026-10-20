begin;

do $$
declare
  professor_id uuid := gen_random_uuid();
  other_professor uuid := gen_random_uuid();
  cluster_id uuid := gen_random_uuid();
  student_a uuid := gen_random_uuid();
  course_a uuid := gen_random_uuid();
  course_b uuid := gen_random_uuid();
  t text;
  priv text;
  request jsonb;
  v_group uuid;
  first_exam uuid;
  rev bigint;
  blocked boolean;
  message text;
  questions jsonb := '[{"question_text":"Original one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":2},{"question_text":"Original two?","question_type":"multiple_choice","choices":["Yes","No"],"correct_answer":"Yes","correct_answers":[],"question_config":{},"manual_grading":false,"points":3}]';
  revised jsonb := '[{"question_text":"Revised one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"B","correct_answers":[],"question_config":{},"manual_grading":false,"points":2},{"question_text":"Revised two?","question_type":"multiple_choice","choices":["Yes","No"],"correct_answer":"No","correct_answers":[],"question_config":{},"manual_grading":false,"points":3}]';
begin
  -- A. Table privileges
  foreach t in array array['public.exam_publish_groups', 'public.exam_publish_group_members'] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', t, priv) then
        raise exception 'anon still has % on %', priv, t;
      end if;
      if priv <> 'SELECT' and has_table_privilege('authenticated', t, priv) then
        raise exception 'authenticated still has % on %', priv, t;
      end if;
    end loop;
    if not has_table_privilege('authenticated', t, 'SELECT') then
      raise exception 'authenticated lost SELECT on %', t;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c, aclexplode(c.relacl) a
    where c.oid in ('public.exam_publish_groups'::regclass, 'public.exam_publish_group_members'::regclass)
      and a.grantee = 0
  ) then
    raise exception 'PUBLIC retains privileges on a group table';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename in ('exam_publish_groups', 'exam_publish_group_members')) <> 2 then
    raise exception 'Group RLS policies changed';
  end if;

  -- B. Approved shared exam edited after review
  insert into auth.users(id, email) values
    (professor_id, 'hardening-professor@example.invalid'),
    (other_professor, 'hardening-other@example.invalid'),
    (cluster_id, 'hardening-cluster@example.invalid'),
    (student_a, 'hardening-student@example.invalid');
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'Hardening Professor' where id = professor_id;
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'Hardening Other' where id = other_professor;
  update public.profiles set role = 'Cluster Professor', status = 'Active', full_name = 'Hardening Cluster' where id = cluster_id;
  update public.profiles set role = 'Student', status = 'Active', full_name = 'Hardening Student' where id = student_a;
  insert into public.courses(id, course_name, course_code, section, joining_code, professor_id, archived) values
    (course_a, 'Hardening A', 'HDA', 'A', 'HDA-' || course_a::text, professor_id, false),
    (course_b, 'Hardening B', 'HDB', 'B', 'HDB-' || course_b::text, professor_id, false);
  insert into public.course_enrollments(course_id, student_id) values (course_a, student_a);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1-2. Create the shared group and submit it for review.
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.publish_exam_group(null,
    jsonb_build_object('title', 'Hardening Group', 'status', 'Pending Review', 'duration', 45,
      'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    questions, array[course_a, course_b], '{}'::jsonb, 'hardening-review-key');
  v_group := (request->>'group_id')::uuid;
  select m.exam_id into first_exam from public.exam_publish_group_members m
  where m.group_id = (request->>'group_id')::uuid and m.course_id = course_a;
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = (request->>'group_id')::uuid and e.status = 'Pending Review' and e.submitted_at is not null) <> 2 then
    raise exception 'Group was not submitted for review on every member';
  end if;

  -- 3. Cluster Professor approves.
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(first_exam, 'approve', 'Approved for publishing.');
  rev := (request->>'revision')::bigint;
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.status = 'Unpublished' and e.approved_at is not null) <> 2 then
    raise exception 'Approval was not applied to every member';
  end if;

  -- 4. Professor edits the shared questionnaire.
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.save_exam_group(v_group,
    jsonb_build_object('title', 'Hardening Revised', 'duration', 45,
      'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    revised, '{}'::jsonb, rev);
  rev := (request->>'revision')::bigint;

  -- 5. Approval cleared on every member; submission marker kept.
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.title = 'Hardening Revised' and e.status = 'Unpublished'
        and e.approved_at is null and e.submitted_at is not null) <> 2 then
    raise exception 'Edit did not clear approval on every member';
  end if;
  -- 6. Review history preserved.
  if (select count(*) from public.exam_reviews r join public.exam_publish_group_members m on m.exam_id = r.exam_id
      where m.group_id = v_group and r.decision = 'Approved') <> 2 then
    raise exception 'Review history was not preserved after the edit';
  end if;

  -- 7-8. Publishing without renewed approval is rejected.
  blocked := false;
  begin
    perform public.transition_exam_group(v_group, 'publish', rev);
  exception when others then
    blocked := true;
    message := sqlerrm;
  end;
  if not blocked or message not like '%approval is required%' then
    raise exception 'Edited approved group published without renewed review (%)', coalesce(message, 'no error');
  end if;
  blocked := false;
  begin
    perform public.save_exam_group(v_group,
      jsonb_build_object('title', 'Hardening Sneak Publish', 'status', 'Published', 'duration', 45,
        'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
      revised, '{}'::jsonb, rev);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Save-and-publish bypassed renewed review'; end if;
  blocked := false;
  begin
    perform set_config('request.jwt.claim.sub', other_professor::text, true);
    perform public.transition_exam_group(v_group, 'publish', rev);
  exception when others then blocked := true;
  end;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  if not blocked then raise exception 'Another professor transitioned the group'; end if;

  -- 9. Single-member paths cannot bypass group protections.
  blocked := false;
  begin
    perform public.publish_exam(first_exam);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'publish_exam bypassed the group guard'; end if;
  blocked := false;
  begin
    update public.exams set approved_at = now() where id = first_exam;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Direct approval write bypassed the group guard'; end if;

  -- No partial changes from the rejected attempts.
  if (select revision from public.exam_publish_groups where id = v_group) <> rev
     or (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
         where m.group_id = v_group and e.title = 'Hardening Revised' and e.status = 'Unpublished'
           and e.approved_at is null) <> 2 then
    raise exception 'Rejected publish attempts left partial changes';
  end if;

  -- 10-12. Resubmit, approve, publish.
  request := public.transition_exam_group(v_group, 'submit_review', rev);
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  request := public.review_exam_group(first_exam, 'approve', 'Approved after revision.');
  rev := (request->>'revision')::bigint;
  if (select count(*) from public.exam_reviews r join public.exam_publish_group_members m on m.exam_id = r.exam_id
      where m.group_id = v_group and r.decision = 'Approved') <> 4 then
    raise exception 'Renewed approval was not recorded for every member';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(v_group, 'publish', rev);
  if (select count(*) from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id
      where m.group_id = v_group and e.status = 'Published' and e.title = 'Hardening Revised') <> 2 then
    raise exception 'Re-approved group did not publish on every member';
  end if;

  -- A (runtime). Owner reads under RLS; direct client writes are refused.
  perform set_config('role', 'authenticated', true);
  if (select count(*) from public.exam_publish_groups g where g.id = v_group) <> 1
     or (select count(*) from public.exam_publish_group_members m where m.group_id = v_group) <> 2 then
    raise exception 'Owner can no longer read the group under RLS';
  end if;
  perform set_config('request.jwt.claim.sub', cluster_id::text, true);
  if (select count(*) from public.exam_publish_group_members m where m.group_id = v_group) <> 2 then
    raise exception 'Cluster reviewer can no longer read group members';
  end if;
  perform set_config('request.jwt.claim.sub', other_professor::text, true);
  if exists (select 1 from public.exam_publish_groups g where g.id = v_group) then
    raise exception 'Another professor read the group';
  end if;
  perform set_config('request.jwt.claim.sub', professor_id::text, true);

  blocked := false;
  begin
    insert into public.exam_publish_groups(created_by, request_key, request_payload, request_digest)
    values (professor_id, 'client-insert', '{}'::jsonb, 'x');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'authenticated inserted a group directly'; end if;
  blocked := false;
  begin
    update public.exam_publish_groups set revision = revision + 1 where id = v_group;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'authenticated update was not refused by privileges'; end if;
  blocked := false;
  begin
    delete from public.exam_publish_group_members where group_id = v_group;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'authenticated delete was not refused by privileges'; end if;
  blocked := false;
  begin
    truncate public.exam_publish_group_members;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'authenticated TRUNCATE was permitted'; end if;

  perform set_config('role', 'anon', true);
  blocked := false;
  begin
    perform 1 from public.exam_publish_groups limit 1;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'anon can read group table'; end if;
  blocked := false;
  begin
    truncate public.exam_publish_groups, public.exam_publish_group_members;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'anon TRUNCATE was permitted'; end if;
end;
$$;

rollback;
