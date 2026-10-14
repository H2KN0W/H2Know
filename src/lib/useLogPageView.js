import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { logActivity } from "./logActivity";

/**
 * Logs a "Viewed X" activity entry for the currently logged-in user
 * the first time a page component mounts.
 *
 * SEC-2: We no longer send user_id, full_name, or role in the body —
 * the hardened log-activity edge function now derives those server-side
 * from the caller's JWT so they cannot be spoofed by the client.
 *
 * Usage in any admin/manager page:
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

      // Only pass the fields the hardened edge function accepts.
      await logActivity({ activity: activityLabel, status: "Success" });
    };

    log();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};