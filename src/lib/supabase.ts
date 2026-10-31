import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError = !url || !key
  ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them in .env.local (local) or Vercel → Settings → Environment Variables."
  : null;

export const supabase = createClient(url ?? "http://localhost", key ?? "missing");
