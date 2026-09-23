# Local Supabase Security Baseline

This folder is for disposable local validation only. Do not apply these files to the linked or hosted Supabase project.

## Why This Exists

The repository migrations are not a full bootstrap history. The first migration, `20260910_exam_safety.sql`, already expects core tables such as `public.exams`, `public.profiles`, `public.courses`, `public.exam_questions`, `public.exam_attempts`, `public.violations`, and related review/log tables to exist.

The local baseline therefore uses `supabase/schema.sql`, which already represents the pre-`20260910` application schema, then manually applies the migration files in filename order. This avoids adding a bootstrap migration to `supabase/migrations` and avoids touching hosted migration history.

## Run

Start Docker Desktop, then run:

```powershell
.\scripts\local-supabase-security-baseline.ps1
```

The script connects only to the local database URL:

```text
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

It refuses database URLs that do not point at `127.0.0.1` or `localhost`.

## What It Does

1. Temporarily moves `supabase/migrations` to `supabase/.local-bootstrap-migrations`.
2. Runs `supabase start` so Supabase-owned schemas and services initialize without applying the incomplete application migration chain first.
3. Restores the original `supabase/migrations` directory.
4. Applies `supabase/schema.sql`.
5. Verifies `public.profiles` and `public.exams` exist before `20260910_exam_safety.sql`.
6. Applies every file in `supabase/migrations` in filename order with `psql`.
7. Runs `supabase/local/security-runtime-matrix.sql`.

Because the migrations are applied with `psql`, duplicate Supabase migration version prefixes such as `20260916_*`, `20260917_*`, and `20260918_*` do not mutate or repair any migration ledger.

The migration directory is restored in a `finally` block if startup fails. If `supabase/.local-bootstrap-migrations` is already present, the script refuses to continue so a previous interrupted local run can be inspected instead of overwritten.

## Hosted Security Preparation Artifacts

These files are local preparation artifacts only. They do not execute automatically.

1. Run `hosted-security-precheck.sql` manually against hosted Supabase and review the output before any hosted mutation.
2. Do not run `hosted-security-deployment.sql` until precheck output has been reviewed.
3. After an approved deployment, run `hosted-security-postcheck.sql` manually to verify installed objects.
4. Do not run `hosted-security-rollback.sql` until hosted pre-deployment function, policy, trigger, and grant definitions have been captured and pasted into the rollback plan.

Never use `supabase db push --linked` for this repository state; duplicate migration prefixes and hosted ledger drift require a controlled SQL deployment package.
