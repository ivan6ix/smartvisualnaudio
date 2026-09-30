with samples as (
  select
    public.grade_exam_answer(row(
      '00000000-0000-0000-0000-000000000001'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      'Drag',
      'Drag and Drop',
      '[{"id":"a","key":"A","value":"Alpha"},{"id":"b","key":"B","value":"Beta"},{"id":"c","key":"C","value":"Gamma"}]'::jsonb,
      '',
      6,
      '["a","c"]'::jsonb,
      '{}'::jsonb,
      false
    )::public.exam_questions, '["c","a"]'::jsonb) as drag_full,
    public.grade_exam_answer(row(
      '00000000-0000-0000-0000-000000000002'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      'Drag',
      'Drag and Drop',
      '[{"id":"a","key":"A","value":"Alpha"},{"id":"b","key":"B","value":"Beta"},{"id":"c","key":"C","value":"Gamma"}]'::jsonb,
      '',
      6,
      '["a","c"]'::jsonb,
      '{}'::jsonb,
      false
    )::public.exam_questions, '["a","b","c"]'::jsonb) as drag_extra,
    public.grade_exam_answer(row(
      '00000000-0000-0000-0000-000000000003'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      'MC',
      'Multiple Choice',
      '[{"id":"choice-a","key":"A","value":"Alpha"}]'::jsonb,
      'A',
      5,
      '["A"]'::jsonb,
      '{}'::jsonb,
      false
    )::public.exam_questions, '"choice-a"'::jsonb) as legacy_mc,
    public.grade_exam_answer(row(
      '00000000-0000-0000-0000-000000000004'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      'Match',
      'Matching Type',
      '[]'::jsonb,
      '',
      4,
      '[]'::jsonb,
      '{"partialMatch":true,"matchingLeftItems":[{"id":"l1","text":"HTTP"},{"id":"l2","text":"CPU"}],"matchingRightItems":[{"id":"r1","text":"Protocol"},{"id":"r2","text":"Processor"}],"matchingConnections":[{"leftId":"l1","rightId":"r1"},{"leftId":"l2","rightId":"r2"}]}'::jsonb,
      false
    )::public.exam_questions, '{"l1":"r1"}'::jsonb) as match_partial,
    public.sanitize_student_question_config(row(
      '00000000-0000-0000-0000-000000000005'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      'Match',
      'Matching Type',
      '[]'::jsonb,
      '',
      4,
      '[]'::jsonb,
      '{"matchingLeftItems":[{"id":"l1","text":"HTTP"}],"matchingRightItems":[{"id":"r1","text":"Protocol"}],"matchingConnections":[{"leftId":"l1","rightId":"r1"}],"answerKey":"secret"}'::jsonb,
      false
    )::public.exam_questions, 'seed') as sanitized
)
select
  drag_full->>'earnedPoints' as drag_full,
  drag_extra->>'earnedPoints' as drag_extra,
  legacy_mc->>'earnedPoints' as legacy_mc,
  match_partial->>'earnedPoints' as match_partial,
  sanitized ? 'matchingConnections' as leaks_connections,
  sanitized ? 'answerKey' as leaks_answer_key
from samples;
