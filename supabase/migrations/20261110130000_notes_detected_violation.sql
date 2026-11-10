-- Live exam monitoring now records papers, notes and books held up to the camera as their own violation.
alter type public.violation_type add value if not exists 'NOTES_DETECTED';
