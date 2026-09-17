import { supabase } from "./supabase";

export const logActivity = async ({ user_id, full_name, role, activity, status }) => {
  await supabase.functions.invoke("log-activity", {
    body: { user_id, full_name, role, activity, status },
  });
};