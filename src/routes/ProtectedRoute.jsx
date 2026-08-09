import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const ProtectedRoute = ({ children, requiredRole }) => {
  const [status, setStatus] = useState("loading"); // loading | allowed | denied

  useEffect(() => {
    let isMounted = true;

    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (isMounted) setStatus("denied");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, status")
        .eq("id", session.user.id)
        .single();

      if (!isMounted) return;

      if (error || !profile || profile.status !== "approved") {
        setStatus("denied");
        return;
      }

      if (requiredRole && profile.role !== requiredRole) {
        setStatus("denied");
        return;
      }

      setStatus("allowed");
    };

    check();
    return () => {
      isMounted = false;
    };
  }, [requiredRole]);

  if (status === "loading") return <div>Loading...</div>;
  if (status === "denied") return <Navigate to="/" replace />;
  return children;
};

export default ProtectedRoute;