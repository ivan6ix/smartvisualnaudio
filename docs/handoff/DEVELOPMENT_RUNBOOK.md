# Development Runbook

## Required Software

- Node.js/npm compatible with Vite 5.
- Supabase CLI for local database and migration work.
- Docker if running local Supabase.
- Vercel CLI only if explicitly deploying or testing Vercel behavior.

## Environment Variables

Frontend variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ENV_SCAN_ENDPOINT`
- `VITE_ROBOFLOW_ENV_SCAN_ENDPOINT`
- `VITE_ROBOFLOW_PROXY_URL`
- `VITE_ROBOFLOW_WORKSPACE`
- `VITE_ROBOFLOW_WORKFLOW_ID`
- `VITE_ROBOFLOW_STREAM_OUTPUTS`
- `VITE_ROBOFLOW_DATA_OUTPUTS`
- `VITE_ROBOFLOW_OBJECT_CONFIDENCE`
- `VITE_ROBOFLOW_MODEL`
- `VITE_ROBOFLOW_MODEL_VERSION`
- `VITE_ROBOFLOW_API_BASE`
- `VITE_ROBOFLOW_PLAN`
- `VITE_ROBOFLOW_REGION`

Server/Edge secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`
- `SITE_URL`
- `ROBOFLOW_API_KEY`
- `ROBOFLOW_ENV_MODEL_ID`
- `ROBOFLOW_ENV_MODEL_VERSION`
- `ROBOFLOW_ENV_CONFIDENCE`
- `ROBOFLOW_ENV_API_BASE`
- `ROBOFLOW_ENV_INFER_URL`
- `ROBOFLOW_PROXY_PORT`
- `ROBOFLOW_PROXY_ORIGIN`

Do not place private keys in `VITE_` variables for production.

## Setup

```powershell
npm.cmd install
```

Copy `.env.example` to `.env` and fill only the values needed for local work. With no Supabase URL/key, the app has demo-mode fallback behavior in development.

## Run Locally

```powershell
npm.cmd run dev
```

Optional Roboflow proxy:

```powershell
npm.cmd run roboflow-proxy
```

## Verification Commands

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
git diff --check
```

Only report a command as passing when it has actually completed successfully.

## Supabase Workflow

- Inspect CLI help before using commands: `supabase --help`.
- Do not apply migrations to hosted databases without approval.
- For local testing, run Supabase locally with Docker and apply migrations in order.
- Use `supabase/local/*runtime*.sql` fixtures for targeted runtime checks.
- Use `supabase migration list --local` or linked migration list only when intentionally verifying migration state.
- Run advisors before production schema changes where available.

## Deployment

- Vercel uses `vercel.json` SPA rewrites and asset caching.
- Edge Functions live under `supabase/functions/`; deploy them separately through Supabase tooling.
- Required Edge Function secrets must be set server-side.
- Do not deploy from an unreviewed dirty working tree.

## Troubleshooting

- Missing Supabase env: app may run in demo mode; database workflows will not persist.
- Profile load failure: auth context can fall back to cached/metadata role, but backend checks remain authoritative.
- Student monitoring unavailable: check browser permissions, HTTPS/local origin, Roboflow proxy/endpoint env, and Storage policies.
- Storage signed URL failures: verify bucket exists, file path convention, RLS/storage policy, and user role.
- Grouped exam edit failures: check `get_exam_group` revision, member divergence, archived state, and whether any member has attempts/start sessions.
