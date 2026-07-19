import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { logActivity } from "./logActivity";

/**
 * Logs a "Viewed X" activity entry for the currently logged-in user
 * the first time a page component mounts.
 *
 * Usage in any admin page:
 *   useLogPageView("Viewed Dashboard");
 */
export const useLogPageView = (activityLabel) => {
  const hasLogged = useRef(false);

  useEffect(() => {
    if (hasLogged.current) return; // prevents StrictMode double-invoke in dev
    hasLogged.current = true;

    const log = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", session.user.id)
        .single();

      if (!profile) return;

      await logActivity({
        user_id: session.user.id,
        full_name: profile.full_name,
        role: profile.role,
        activity: activityLabel,
        status: "Success",
      });
    };

    log();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};