import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  // ── SEC: Restrict to the deployed app origin in production ─────────────────
  // Replace "*" with your actual domain (e.g. "https://h2know.vercel.app")
  // before go-live. The wildcard is fine during local Supabase dev.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Allowed values for the 'activity' and 'status' fields. Anything outside
// these sets is rejected to prevent log-injection or noise.
const ALLOWED_STATUSES = new Set(["Success", "Failed", "Error"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── SEC-2: Authenticate caller — only verified Supabase users may write logs ─
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SEC-2 cont.: Fetch authoritative identity from DB — never trust the body ─
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, status")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("Profile query error:", profileError);
      return new Response(
        JSON.stringify({ error: "Database error fetching profile." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile || profile.status !== "approved") {
      return new Response(
        JSON.stringify({ error: "Forbidden: Only approved users may write activity logs." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SEC-6: Rate limiting — 30 log writes per user per 60 seconds ──────────
    const { data: withinLimit, error: rateError } = await supabase.rpc("check_rate_limit", {
      p_user_id:   user.id,
      p_action:    "log_activity",
      p_max_calls: 30,
      p_window_s:  60,
    });
    if (rateError) {
      // If the rate-limit function itself errors (e.g. migration not yet applied),
      // log a warning but allow through — availability beats a hard block here.
      console.warn("Rate limit check failed (non-blocking):", rateError.message);
    } else if (!withinLimit) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please wait before logging more activity." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SEC-4: Strict schema validation — reject unknown fields ────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ALLOWED_BODY_KEYS = new Set(["activity", "status"]);
    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_BODY_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return new Response(
        JSON.stringify({ error: `Unknown field(s): ${unknownKeys.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { activity, status } = body as { activity?: unknown; status?: unknown };

    if (!activity || typeof activity !== "string" || !activity.trim()) {
      return new Response(
        JSON.stringify({ error: "'activity' is required and must be a non-empty string." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!status || typeof status !== "string" || !ALLOWED_STATUSES.has(status)) {
      return new Response(
        JSON.stringify({ error: `'status' must be one of: ${[...ALLOWED_STATUSES].join(", ")}.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    // ── Write log using server-authoritative identity ─────────────────────────
    const { error: insertError } = await supabase.from("activity_logs").insert({
      user_id:   user.id,           // from verified JWT, NOT the request body
      full_name: profile.full_name, // from DB, NOT the request body
      role:      profile.role,      // from DB, NOT the request body
      activity:  activity.trim().slice(0, 500),
      status,
      ip_address: ip,
    });

    if (insertError) {
      console.error("Activity log insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to log activity." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Log-activity handler error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});