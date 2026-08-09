import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import "../styles/Login.css";
import H2knowLogo from "../assets/img/H2knowlogo.jpg";

const REMEMBER_KEY = "h2know_remembered_email";

const Login = () => {
  const [email, setEmail] = useState(
    () => localStorage.getItem(REMEMBER_KEY) || ""
  );
  const [rememberMe, setRememberMe] = useState(
    () => Boolean(localStorage.getItem(REMEMBER_KEY))
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const getFriendlyErrorMessage = (err) => {
    const message = err?.message || "";
    if (message.includes("Invalid login credentials")) {
      return "Invalid email or password.";
    }
    if (message.includes("Email not confirmed")) {
      return "Please confirm your email address before logging in.";
    }
    if (message.toLowerCase().includes("too many")) {
      return "Too many login attempts. Please wait a moment and try again.";
    }
    if (message.includes("network")) {
      return "Network error. Please check your connection and try again.";
    }
    return message || "Something went wrong. Please try again.";
  };

  // Checks a signed-in user's approval status and blocks access if not approved.
  const verifyAccess = async (userId) => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", userId)
      .single();

    if (profileError) {
      throw new Error("Could not verify your account. Please contact an administrator.");
    }

    if (profile.status === "pending") {
      await supabase.auth.signOut();
      throw new Error("Your account is awaiting admin approval. Please check back later.");
    }

    if (profile.status === "rejected") {
      await supabase.auth.signOut();
      throw new Error("Your account access was denied. Please contact an administrator.");
    }

    return profile;
  };

  // Handles users returning from the Google OAuth redirect
  useEffect(() => {
    const checkOAuthSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      setGoogleLoading(true);
      setError("");

      try {
        const profile = await verifyAccess(session.user.id);
        console.log("Google login successful:", session.user.email);
        console.log("User role:", profile.role);
        // Placeholder redirect only — Dashboard module isn't built yet.
      } catch (err) {
        setError(err.message);
      } finally {
        setGoogleLoading(false);
      }
    };

    checkOAuthSession();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;

      const profile = await verifyAccess(data.user.id);

      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      console.log("Login successful:", data.user.email);
      console.log("User role:", profile.role);
      // Placeholder redirect only — Dashboard module isn't built yet.
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setGoogleLoading(true);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (oauthError) {
      setError(getFriendlyErrorMessage(oauthError));
      setGoogleLoading(false);
    }
    // On success, the browser redirects to Google, then back here —
    // the useEffect above picks up the session on return.
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo-wrap">
          <img
            src={H2knowLogo}
            alt="H2KNOW logo"
            className="logo-img"
            onError={(e) => {
              e.target.style.display = "none";
              e.target.nextSibling.style.display = "flex";
            }}
          />
          <div className="logo-fallback" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M24 4C24 4 10 20.5 10 30.5C10 38.5 16.3 44 24 44C31.7 44 38 38.5 38 30.5C38 20.5 24 4 24 4Z"
                fill="currentColor"
              />
            </svg>
          </div>
        </div>

        <h1 className="brand-title">
            H<sub>2</sub>KNOW
        </h1>
        <p className="brand-tagline">Know the Flow, Before You Go</p>
        <span className="access-badge">Authorized Personnel Only</span>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              disabled={loading || googleLoading}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <div className="password-wrapper">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading || googleLoading}
                required
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowPassword((v) => !v)}
                disabled={loading || googleLoading}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.5 5.3A10.4 10.4 0 0112 5c5 0 9 4 10 7-.4 1.1-1.1 2.3-2.1 3.4M6.2 6.6C4.3 8 3 9.9 2 12c1 3 5 7 10 7 1.4 0 2.7-.3 3.9-.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="form-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading || googleLoading}
              />
              <span>Remember me</span>
            </label>

            <a href="#" className="forgot-link" onClick={handleForgotPassword}>
              Forgot Password?
            </a>
          </div>

          <button type="submit" className="login-button" disabled={loading || googleLoading}>
            {loading ? (
              <span className="spinner" role="status" aria-label="Signing in" />
            ) : (
              "LOGIN"
            )}
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <button
          type="button"
          className="google-button"
          onClick={handleGoogleLogin}
          disabled={loading || googleLoading}
        >
          {googleLoading ? (
            <span className="spinner spinner-dark" role="status" aria-label="Connecting to Google" />
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 01-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A11.99 11.99 0 0012 24z" />
                <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 010-4.58v-3.1H1.26a12 12 0 000 10.78l4.01-3.1z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z" />
              </svg>
              <span>Sign in with Google</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Login;