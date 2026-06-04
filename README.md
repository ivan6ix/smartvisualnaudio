# Smart Proctoring Thru Audio and Visual Monitoring

Modern React/Vite university administration dashboard for a smart proctoring system.

## Stack

- React, Vite, React Router DOM
- Supabase Auth, PostgreSQL, Storage, Realtime ready
- React Hook Form, React Icons, Recharts, Sonner
- Tailwind pipeline with custom responsive CSS

## Run Locally

```bash
npm.cmd install
npm.cmd run dev
```

Create `.env` from `.env.example` and add Supabase credentials when your project is ready. Without credentials, the app runs in demo mode with local fallback data.

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor to create tables, enums, basic RLS policies, and the auth profile trigger.

## Brevo Password Reset

Deploy the Edge Function and set secrets:

```bash
npx supabase@latest functions deploy send-password-reset
npx supabase@latest secrets set BREVO_API_KEY=your_brevo_key
npx supabase@latest secrets set BREVO_SENDER_EMAIL=your_verified_sender@email.com
npx supabase@latest secrets set BREVO_SENDER_NAME="Smart Proctoring System"
npx supabase@latest secrets set SITE_URL=http://localhost:5173
```
