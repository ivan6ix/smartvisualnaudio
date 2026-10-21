-- Add the microphone violation types the student exam page records (StudentExamTake.jsx,
-- useLiveAudioMonitoring.js). Without them every microphone-loss insert failed with
-- "invalid input value for enum violation_type" (HTTP 400), so these events were never saved.
-- Additive only: no existing rows or values change. Kept in its own migration because a new
-- enum value cannot be used in the same transaction that adds it.
alter type public.violation_type add value if not exists 'MICROPHONE_UNAVAILABLE';
alter type public.violation_type add value if not exists 'MICROPHONE_DISCONNECTED';
alter type public.violation_type add value if not exists 'MICROPHONE_MUTED';
alter type public.violation_type add value if not exists 'MICROPHONE_ACCESS_LOST';
