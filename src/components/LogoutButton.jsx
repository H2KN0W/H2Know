import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { logActivity } from "../lib/logActivity";

/**
 * Drop-in replacement for the plain "Logout" button in every admin
 * page's sidebar. Shows a full-screen loading overlay while signing
 * out and logs the "Logged Out" activity before the session is cleared.
 *
 * Usage:
 *   import LogoutButton from "../../components/LogoutButton";
 *   ...
 *   <LogoutButton />
 */
const LogoutButton = () => {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", session.user.id)
        .single();

      if (profile) {
        await logActivity({
          user_id: session.user.id,
          full_name: profile.full_name,
          role: profile.role,
          activity: "Logged Out",
          status: "Success",
        });
      }
    }

    await supabase.auth.signOut();

    // small delay so the overlay is visibly noticeable even on fast connections
    setTimeout(() => {
      navigate("/");
    }, 600);
  };

  return (
    <>
      <button
        className="sidebar-logout"
        onClick={handleLogout}
        disabled={loggingOut}
      >
        {loggingOut ? "Logging out..." : "Logout"}
      </button>

      {loggingOut && (
        <div className="logout-overlay">
          <div className="logout-overlay-box">
            <span className="spinner spinner-dark" role="status" aria-label="Logging out" />
            <p>Logging out...</p>
          </div>
        </div>
      )}
    </>
  );
};

export default LogoutButton;