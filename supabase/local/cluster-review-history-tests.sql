begin;

do $$
declare
  professor_id uuid := gen_random_uuid();
  cluster_a uuid := gen_random_uuid();
  cluster_b uuid := gen_random_uuid();
  course_a uuid := gen_random_uuid();
  course_b uuid := gen_random_uuid();
  single_exam uuid;
  other_exam uuid;
  request jsonb;
  v_group uuid;
  member_exam uuid;
  rev bigint;
  blocked boolean;
  n integer;
  questions jsonb := '[{"question_text":"History one?","question_type":"multiple_choice","choices":["A","B"],"correct_answer":"A","correct_answers":[],"question_config":{},"manual_grading":false,"points":1}]';
begin
  if to_regprocedure('public.get_cluster_review_history()') is null then
    raise exception 'Review history lookup is missing';
  end if;
  if has_function_privilege('anon', 'public.get_cluster_review_history()', 'EXECUTE') then
    raise exception 'anon can execute the review history lookup';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.get_cluster_review_history()'::regprocedure and a.grantee = 0) then
    raise exception 'PUBLIC can execute the review history lookup';
  end if;
  if pg_get_function_result('public.get_cluster_review_history()'::regprocedure) ~* '(question|answer|student|choices)' then
    raise exception 'Lookup returns question, answer, or student data';
  end if;
  if (select regexp_replace(qual, '\s+', ' ', 'g') from pg_policies where tablename = 'exams' and policyname = 'exams_cluster_review_read')
     not like '%pending review%approved%rejected%' then
    raise exception 'exams_cluster_review_read changed';
  end if;

  insert into auth.users(id, email) values
    (professor_id, 'history-professor@example.invalid'),
    (cluster_a, 'history-cluster-a@example.invalid'),
    (cluster_b, 'history-cluster-b@example.invalid');
  update public.profiles set role = 'Professor', status = 'Active', full_name = 'History Professor' where id = professor_id;
  update public.profiles set role = 'Cluster Professor', status = 'Active', full_name = 'History Cluster A' where id = cluster_a;
  update public.profiles set role = 'Cluster Professor', status = 'Active', full_name = 'History Cluster B' where id = cluster_b;
  insert into public.courses(id, course_name, course_code, section, joining_code, professor_id, archived) values
    (course_a, 'History A', 'HSA', 'A', 'HSA-' || course_a::text, professor_id, false),
    (course_b, 'History B', 'HSB', 'B', 'HSB-' || course_b::text, professor_id, false);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', professor_id::text, true);

  -- Single-course exam: rejected, resubmitted, approved by cluster A (as the review Edge Function writes it).
  single_exam := public.save_exam(null, jsonb_build_object('course_id', course_a, 'title', 'History Single', 'status', 'Pending Review', 'duration', 30, 'exam_settings', '{}'::jsonb), questions);
  insert into public.exam_reviews(exam_id, cluster_professor_id, decision, remarks, review_date) values (single_exam, cluster_a, 'Rejected', 'Single reason.', now() - interval '3 hours');
  insert into public.exam_reviews(exam_id, cluster_professor_id, decision, remarks, review_date) values (single_exam, cluster_a, 'Approved', 'Single approved.', now() - interval '2 hours');
  update public.exams set status = 'Unpublished', approved_at = now() - interval '2 hours', rejected_at = null where id = single_exam;

  -- Another exam reviewed only by cluster B.
  other_exam := public.save_exam(null, jsonb_build_object('course_id', course_b, 'title', 'History Other', 'status', 'Pending Review', 'duration', 30, 'exam_settings', '{}'::jsonb), questions);
  insert into public.exam_reviews(exam_id, cluster_professor_id, decision, remarks) values (other_exam, cluster_b, 'Rejected', 'Cluster B private reason.');
  update public.exams set status = 'Rejected', rejected_at = now() where id = other_exam;

  -- Shared exam: rejected, resubmitted, approved by cluster A, then published.
  request := public.publish_exam_group(null, jsonb_build_object('title', 'History Shared', 'status', 'Pending Review', 'duration', 30, 'exam_settings', '{}'::jsonb, 'assignment_mode', 'entire_course'),
    questions, array[course_a, course_b], '{}'::jsonb, 'history-shared-key');
  v_group := (request->>'group_id')::uuid;
  select m.exam_id into member_exam from public.exam_publish_group_members m where m.group_id = v_group limit 1;
  perform set_config('request.jwt.claim.sub', cluster_a::text, true);
  request := public.review_exam_group(member_exam, 'reject', 'Shared reason.');
  -- Separate transactions in real use; give the rejection an earlier timestamp than the later approval.
  update public.exam_reviews r set review_date = r.review_date - interval '1 minute'
  from public.exam_publish_group_members m
  where m.exam_id = r.exam_id and m.group_id = v_group and r.decision = 'Rejected';
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(v_group, 'submit_review', (request->>'revision')::bigint);
  perform set_config('request.jwt.claim.sub', cluster_a::text, true);
  request := public.review_exam_group(member_exam, 'approve', 'Shared approved.');
  perform set_config('request.jwt.claim.sub', professor_id::text, true);
  request := public.transition_exam_group(v_group, 'publish', (request->>'revision')::bigint);

  -- Cluster A sees only its own history, including approvals after Unpublished/Published.
  perform set_config('request.jwt.claim.sub', cluster_a::text, true);
  if exists (select 1 from public.get_cluster_review_history() h where h.remarks = 'Cluster B private reason.') then
    raise exception 'Cluster A saw another reviewer''s decision';
  end if;
  if (select count(*) from public.get_cluster_review_history() h where h.exam_id = single_exam) <> 2
     or not exists (select 1 from public.get_cluster_review_history() h where h.exam_id = single_exam and h.decision = 'Rejected' and h.remarks = 'Single reason.')
     or not exists (select 1 from public.get_cluster_review_history() h where h.exam_id = single_exam and h.decision = 'Approved' and h.remarks = 'Single approved.' and h.exam_status = 'Unpublished') then
    raise exception 'Single-course history incomplete after approval';
  end if;
  if (select count(*) from public.get_cluster_review_history() h where h.group_id = v_group) <> 4
     or (select count(distinct h.shared_course_count) from public.get_cluster_review_history() h where h.group_id = v_group) <> 1
     or exists (select 1 from public.get_cluster_review_history() h where h.group_id = v_group and h.decision = 'Approved' and h.exam_status <> 'Published') then
    raise exception 'Shared history incomplete or inconsistent after publish';
  end if;
  select count(distinct coalesce(h.group_id, h.exam_id)) into n from public.get_cluster_review_history() h where h.currently_approved;
  if n <> 2 then raise exception 'Expected 2 current approvals (one single, one shared), got %', n; end if;
  if exists (select 1 from public.get_cluster_review_history() h where h.decision = 'Rejected' and h.currently_approved) then
    raise exception 'A rejection was counted as an approval';
  end if;

  -- A later rejection makes the earlier approval outdated.
  insert into public.exam_reviews(exam_id, cluster_professor_id, decision, remarks, review_date) values (single_exam, cluster_a, 'Rejected', 'Reopened issue.', now() - interval '1 hour');
  update public.exams set status = 'Rejected', approved_at = null, rejected_at = now() where id = single_exam;
  select count(distinct coalesce(h.group_id, h.exam_id)) into n from public.get_cluster_review_history() h where h.currently_approved;
  if n <> 1 then raise exception 'Outdated approval still counted (got %)', n; end if;
  if (select count(*) from public.get_cluster_review_history() h where h.exam_id = single_exam) <> 3 then
    raise exception 'Earlier review records were lost';
  end if;

  -- Cluster B sees only its own decision.
  perform set_config('request.jwt.claim.sub', cluster_b::text, true);
  if (select count(*) from public.get_cluster_review_history()) <> 1 then
    raise exception 'Cluster B history is not isolated';
  end if;

  -- Non-reviewers and inactive reviewers are refused.
  blocked := false;
  begin
    perform set_config('request.jwt.claim.sub', professor_id::text, true);
    perform 1 from public.get_cluster_review_history();
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'A professor read cluster review history'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set status = 'Deactivated' where id = cluster_b;
  blocked := false;
  begin
    perform set_config('request.jwt.claim.sub', cluster_b::text, true);
    perform 1 from public.get_cluster_review_history();
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'An inactive cluster professor read review history'; end if;

  -- Exams RLS is unchanged: cluster A still cannot read the published shared exam directly.
  perform set_config('request.jwt.claim.sub', cluster_a::text, true);
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.exams e join public.exam_publish_group_members m on m.exam_id = e.id where m.group_id = v_group) then
    raise exception 'Cluster gained direct read access to published exams';
  end if;
  if (select count(*) from public.get_cluster_review_history() h where h.group_id = v_group) <> 4 then
    raise exception 'Authenticated cluster role cannot use the lookup';
  end if;
  perform set_config('role', 'anon', true);
  blocked := false;
  begin
    perform 1 from public.get_cluster_review_history();
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'anon executed the review history lookup'; end if;
end;
$$;

rollback;
