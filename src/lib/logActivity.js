import { supabase } from "./supabase";

/**
 * Log an authenticated user action.
 *
 * SEC-2: The edge function now derives user identity (user_id, full_name, role)
 * from the caller's validated JWT + profiles table, so we MUST NOT send those
 * fields in the request body (the function will reject unknown keys with 400).
 * Only `activity` and `status` are accepted.
 *
 * @param {{ activity: string, status: "Success" | "Failed" | "Error" }} params
 */
export const logActivity = async ({ activity, status }) => {
  await supabase.functions.invoke("log-activity", {
    body: { activity, status },
  });
};