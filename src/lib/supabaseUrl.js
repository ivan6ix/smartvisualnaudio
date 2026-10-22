// Guards local development against silently reading or writing hosted Supabase data.

export function isLocalSupabaseUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(String(url || ""));
}

// Returns an error message when a dev build points at a non-local project without an explicit opt-in.
export function getDevSupabaseUrlError({ dev, url, allowHosted }) {
  if (!dev || !url || isLocalSupabaseUrl(url) || allowHosted === "true") return "";
  return "The development server is configured for a hosted Supabase project. Point VITE_SUPABASE_URL in .env.development.local at the local stack, or set VITE_ALLOW_HOSTED_SUPABASE_IN_DEV=true to use hosted data on purpose.";
}
