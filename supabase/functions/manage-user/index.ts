import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, ...payload } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- CREATE a brand new user (Add New User) ----
    if (action === "create") {
      const { email, password, full_name, role } = payload;

      if (!email || !password || !full_name || !role) {
        return new Response(
          JSON.stringify({ error: "Missing required fields." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: created, error: createError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // skip email verification since admin is creating this directly
          user_metadata: { full_name },
        });

      if (createError) {
        return new Response(
          JSON.stringify({ error: createError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // handle_new_user() trigger auto-creates the profiles row on auth.users insert,
      // but role defaults to 'manager' and status defaults to 'pending' — update both
      // to match what the admin actually selected, and mark it pre-approved.
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ role, status: "approved", has_password: true })
        .eq("id", created.user.id);

      if (profileError) {
        return new Response(
          JSON.stringify({ error: profileError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ success: true, user_id: created.user.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- UPDATE an existing user's email ----
    if (action === "update_email") {
      const { user_id, new_email } = payload;

      if (!user_id || !new_email) {
        return new Response(
          JSON.stringify({ error: "Missing required fields." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
        user_id,
        { email: new_email, email_confirm: true }
      );

      if (updateAuthError) {
        return new Response(
          JSON.stringify({ error: updateAuthError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({ email: new_email })
        .eq("id", user_id);

      if (updateProfileError) {
        return new Response(
          JSON.stringify({ error: updateProfileError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- DELETE a user entirely (real removal, not just profiles row) ----
    if (action === "delete") {
      const { user_id } = payload;

      if (!user_id) {
        return new Response(
          JSON.stringify({ error: "Missing user_id." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: deleteError } = await supabase.auth.admin.deleteUser(user_id);

      if (deleteError) {
        return new Response(
          JSON.stringify({ error: deleteError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // profiles row is removed automatically if it has ON DELETE CASCADE
      // tied to auth.users; otherwise delete it explicitly here too.
      await supabase.from("profiles").delete().eq("id", user_id);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});