-- Feature #5 runtime checks. Run in a disposable/local database.
-- Verifies normal assignment and special exception access without deleting history.

create temporary table if not exists feature5_test_results (
  check_name text primary key,
  status text not null,
  details text
) on commit preserve rows;

insert into feature5_test_results values
  ('01 assignment_mode_column_exists',
   case when exists (
     select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exams' and column_name = 'assignment_mode'
   ) then 'PASS' else 'FAIL' end,
   'exams.assignment_mode required')
on conflict (check_name) do update set status = excluded.status, details = excluded.details;

insert into feature5_test_results values
  ('02 normal_assignment_table_exists',
   case when to_regclass('public.exam_student_assignments') is not null then 'PASS' else 'FAIL' end,
   'normal assignment junction table required')
on conflict (check_name) do update set status = excluded.status, details = excluded.details;

insert into feature5_test_results values
  ('03 exception_table_exists',
   case when to_regclass('public.exam_student_access_exceptions') is not null then 'PASS' else 'FAIL' end,
   'special share exception table required')
on conflict (check_name) do update set status = excluded.status, details = excluded.details;

insert into feature5_test_results values
  ('04 canonical_access_function_exists',
   case when exists (
     select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'student_can_take_exam'
   ) then 'PASS' else 'FAIL' end,
   'student_can_take_exam must exist')
on conflict (check_name) do update set status = excluded.status, details = excluded.details;

insert into feature5_test_results values
  ('05 publish_guard_exists',
   case when exists (
     select 1 from pg_trigger
     where tgname = 'guard_selected_student_publish'
   ) then 'PASS' else 'FAIL' end,
   'selected-students publish guard required')
on conflict (check_name) do update set status = excluded.status, details = excluded.details;

select * from feature5_test_results order by check_name;
