-- Targeted hosted correction for interruption RPC execute privileges only.
-- Run only after review; does not change RPC business logic or data.
begin;

revoke execute on function public.record_exam_interruption_recovery(uuid, text) from public;
revoke execute on function public.record_exam_interruption_recovery(uuid, text) from anon;
grant execute on function public.record_exam_interruption_recovery(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
