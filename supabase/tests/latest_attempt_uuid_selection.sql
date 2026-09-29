begin;

create temp table regression_attempts (
  id uuid primary key,
  exam_id uuid not null,
  student_id uuid not null,
  submission_session_started_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz
) on commit drop;

create temp table regression_population (
  exam_id uuid not null,
  student_id uuid not null
) on commit drop;

insert into regression_population (exam_id, student_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012');

insert into regression_attempts (id, exam_id, student_id, submission_session_started_at, started_at, submitted_at) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '2026-09-29 08:00+00', '2026-09-29 08:00+00', '2026-09-29 08:30+00'),
  ('ffffffff-ffff-ffff-ffff-fffffffffffe', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', '2026-09-29 08:00+00', '2026-09-29 08:00+00', '2026-09-29 08:30+00'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', '2026-09-29 09:00+00', '2026-09-29 09:00+00', '2026-09-29 09:30+00');

do $$
declare
  v_no_attempt uuid;
  v_one_attempt uuid;
  v_multiple_attempts uuid;
begin
  with attempt_ranked as (
    select
      a.*,
      row_number() over (
        partition by a.exam_id, a.student_id
        order by coalesce(a.submission_session_started_at, a.started_at, a.submitted_at) desc nulls last,
                 a.submitted_at desc nulls last,
                 a.id desc
      ) as attempt_number_desc
    from regression_attempts a
  ),
  latest_attempts as (
    select exam_id, student_id, id as latest_attempt_id
    from attempt_ranked
    where attempt_number_desc = 1
  )
  select
    la_no.latest_attempt_id,
    la_one.latest_attempt_id,
    la_many.latest_attempt_id
  into v_no_attempt, v_one_attempt, v_multiple_attempts
  from (select 1) seed
  left join latest_attempts la_no
    on la_no.student_id = '00000000-0000-0000-0000-000000000010'
  left join latest_attempts la_one
    on la_one.student_id = '00000000-0000-0000-0000-000000000011'
  left join latest_attempts la_many
    on la_many.student_id = '00000000-0000-0000-0000-000000000012';

  if v_no_attempt is not null then
    raise exception 'Expected no-attempt student latest_attempt_id to be null, got %', v_no_attempt;
  end if;

  if v_one_attempt is distinct from 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid then
    raise exception 'Expected one-attempt student latest_attempt_id to match only attempt, got %', v_one_attempt;
  end if;

  if v_multiple_attempts is distinct from '00000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'Expected timestamp-ranked latest attempt, got %', v_multiple_attempts;
  end if;
end $$;

rollback;
