import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missingEnv = [];
if (!supabaseUrl) missingEnv.push("VITE_SUPABASE_URL");
if (!supabaseAnonKey) missingEnv.push("VITE_SUPABASE_ANON_KEY");
if (missingEnv.length > 0) {
  throw new Error(
    `H2KNOW: missing required build-time env var(s): ${missingEnv.join(", ")}. ` +
      "Set them in your build environment (e.g. Vercel Project Settings > " +
      "Environment Variables) and rebuild."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);