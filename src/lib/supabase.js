import { createClient } from "@supabase/supabase-js";
import { getDevSupabaseUrlError } from "./supabaseUrl";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const devUrlError = getDevSupabaseUrlError({ dev: import.meta.env.DEV, url, allowHosted: import.meta.env.VITE_ALLOW_HOSTED_SUPABASE_IN_DEV });
if (devUrlError) throw new Error(devUrlError);

export const hasSupabaseConfig = Boolean(url && anonKey);
export const supabase = hasSupabaseConfig ? createClient(url, anonKey, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
  },
}) : null;
