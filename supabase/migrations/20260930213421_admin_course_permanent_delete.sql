begin;

create or replace function public.admin_permanently_delete_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles;
  course_row public.courses;
  exam_ids uuid[] := '{}'::uuid[];
  attempt_ids uuid[] := '{}'::uuid[];
  question_ids uuid[] := '{}'::uuid[];
  storage_manifest jsonb := '[]'::jsonb;
  exam_count integer := 0;
  attempt_count integer := 0;
  question_count integer := 0;
  violation_count integer := 0;
  module_count integer := 0;
  permit_file_count integer := 0;
  notification_count integer := 0;
  log_count integer := 0;
begin
  if p_course_id is null then
    raise exception 'Course was not found.';
  end if;

  select *
  into caller
  from public.profiles
  where id = auth.uid();

  if caller.id is null then
    raise exception 'You are not authorized to permanently delete courses.';
  end if;

  if caller.role <> 'Admin' or caller.status <> 'Active' then
    raise exception 'You are not authorized to permanently delete courses.';
  end if;

  select *
  into course_row
  from public.courses
  where id = p_course_id
  for update;

  if course_row.id is null then
    raise exception 'Course was not found.';
  end if;

  if not coalesce(course_row.archived, false) then
    raise exception 'Course must be archived before permanent deletion.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into exam_ids
  from public.exams
  where course_id = course_row.id;

  select coalesce(array_agg(id), '{}'::uuid[])
  into attempt_ids
  from public.exam_attempts
  where exam_id = any(exam_ids);

  select coalesce(array_agg(id), '{}'::uuid[])
  into question_ids
  from public.exam_questions
  where exam_id = any(exam_ids);

  select count(*) into exam_count from public.exams where id = any(exam_ids);
  select count(*) into attempt_count from public.exam_attempts where id = any(attempt_ids);
  select count(*) into question_count from public.exam_questions where id = any(question_ids);
  select count(*) into violation_count from public.violations where course_id = course_row.id or exam_id = any(exam_ids);
  select count(*) into module_count from public.course_modules where course_id = course_row.id;
  select count(*) into permit_file_count from public.course_permit_files where course_id = course_row.id;

  with refs as (
    select 'course-modules'::text as bucket, file_path as path, 'course_modules.file_path'::text as source
    from public.course_modules
    where course_id = course_row.id and nullif(btrim(coalesce(file_path, '')), '') is not null
    union all
    select 'course-permits', file_path, 'course_permit_files.file_path'
    from public.course_permit_files
    where course_id = course_row.id and nullif(btrim(coalesce(file_path, '')), '') is not null
    union all
    select 'exam-submissions', file_url, 'exam_attempt_answers.file_url'
    from public.exam_attempt_answers
    where (attempt_id = any(attempt_ids) or question_id = any(question_ids))
      and nullif(btrim(coalesce(file_url, '')), '') is not null
    union all
    select 'proctor-snapshots', screenshot_url, 'violations.screenshot_url'
    from public.violations
    where (course_id = course_row.id or exam_id = any(exam_ids))
      and nullif(btrim(coalesce(screenshot_url, '')), '') is not null
    union all
    select 'audio-violations', evidence_url, 'violations.evidence_url'
    from public.violations
    where (course_id = course_row.id or exam_id = any(exam_ids))
      and nullif(btrim(coalesce(evidence_url, '')), '') is not null
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', bucket, 'path', path, 'source', source)), '[]'::jsonb)
  into storage_manifest
  from refs;

  delete from public.notifications
  where (entity_type = 'course' and entity_id = course_row.id)
     or (entity_type = 'exam' and entity_id = any(exam_ids));
  get diagnostics notification_count = row_count;

  delete from public.logs
  where (entity_type = 'course' and entity_id = course_row.id)
     or (entity_type = 'exam' and entity_id = any(exam_ids));
  get diagnostics log_count = row_count;

  delete from public.exam_start_sessions
  where exam_id = any(exam_ids);

  delete from public.violations
  where course_id = course_row.id
     or exam_id = any(exam_ids);

  delete from public.exams
  where id = any(exam_ids);

  delete from public.courses
  where id = course_row.id
    and archived = true;

  if not found then
    raise exception 'Course could not be permanently deleted.';
  end if;

  perform public.write_audit_log(
    caller.id,
    caller.role::text,
    'course.permanently_deleted',
    'Course Permanently Deleted',
    'An admin permanently deleted an archived course.',
    'course',
    course_row.id,
    course_row.professor_id,
    jsonb_build_object(
      'deleted_course_id', course_row.id,
      'course_name', course_row.course_name,
      'course_code', course_row.course_code,
      'section', course_row.section,
      'actor_id', caller.id,
      'exam_count', exam_count,
      'attempt_count', attempt_count,
      'question_count', question_count,
      'violation_count', violation_count,
      'module_count', module_count,
      'permit_file_count', permit_file_count,
      'deleted_notification_count', notification_count,
      'deleted_log_count', log_count,
      'storage_object_count', jsonb_array_length(storage_manifest)
    )
  );

  return jsonb_build_object(
    'database_deleted', true,
    'deleted_course_id', course_row.id,
    'course_name', course_row.course_name,
    'course_code', course_row.course_code,
    'section', course_row.section,
    'counts', jsonb_build_object(
      'exams', exam_count,
      'attempts', attempt_count,
      'questions', question_count,
      'violations', violation_count,
      'course_modules', module_count,
      'course_permit_files', permit_file_count,
      'notifications', notification_count,
      'logs', log_count
    ),
    'storage_manifest', storage_manifest
  );
end;
$$;

revoke all on function public.admin_permanently_delete_course(uuid) from public, anon;
grant execute on function public.admin_permanently_delete_course(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
