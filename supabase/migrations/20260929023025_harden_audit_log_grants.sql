begin;

revoke all privileges on table public.logs from anon, authenticated;
grant select on table public.logs to authenticated;

notify pgrst, 'reload schema';

commit;
