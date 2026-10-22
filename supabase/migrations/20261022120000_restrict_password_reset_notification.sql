-- request_admin_password_reset_notification was executable by anon: anyone could submit any staff email
-- and insert notifications for every active Admin plus a log row, without signing in. No client or
-- Edge Function calls it (password resets go through the send-password-reset Edge Function), so only
-- service_role keeps access. Privileges only; no data changes.
revoke all on function public.request_admin_password_reset_notification(text) from public, anon, authenticated;
grant execute on function public.request_admin_password_reset_notification(text) to service_role;
