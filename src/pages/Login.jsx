import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "../styles/Login.css";
import H2knowLogo from "../assets/img/H2knowlogo.jpg";
import { logActivity } from "../lib/logActivity";

const REMEMBER_KEY = "h2know_remembered_email";

const Login = () => {
  const navigate = useNavigate();

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
  const [checkingSession, setCheckingSession] = useState(true);
  const [resetSent, setResetSent] = useState(false);

  // Create Password screen state
  const [needsPassword, setNeedsPassword] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserName, setCurrentUserName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);

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

  const calculatePasswordStrength = (pwd) => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    return score;
  };

  const getStrengthLabel = (score) => {
    if (score <= 1) return "Weak";
    if (score <= 3) return "Medium";
    return "Strong";
  };

  const redirectByRole = async (role) => {
    if (role === "admin") {
      navigate("/admin/dashboard", { replace: true });
    } else {
      setError("You do not have access to this dashboard.");
      await supabase.auth.signOut();
    }
  };

  const verifyAccess = async (userId) => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, status, has_password, full_name")
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

  useEffect(() => {
    const checkOAuthSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setCheckingSession(false);
        return;
      }

      setGoogleLoading(true);
      setError("");

      try {
        const profile = await verifyAccess(session.user.id);

        if (!profile.has_password) {
          setCurrentUserId(session.user.id);
          setCurrentUserName(profile.full_name || session.user.email);
          setNeedsPassword(true);
          setGoogleLoading(false);
          setCheckingSession(false);
          return;
        }

        await redirectByRole(profile.role);
      } catch (err) {
        setError(err.message);
        setGoogleLoading(false);
        setCheckingSession(false);
      }
    };

    checkOAuthSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setResetSent(false);
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;

      const profile = await verifyAccess(data.user.id);

      await logActivity({
        user_id: data.user.id,
        full_name: profile.full_name,
        role: profile.role,
        activity: "Logged In",
        status: "Success",
      });

      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      await redirectByRole(profile.role);
    } catch (err) {
      await logActivity({
        user_id: null,
        full_name: "Unknown",
        role: null,
        activity: "Login Attempt",
        status: "Failed",
      });
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setResetSent(false);
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
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError("");
    setResetSent(false);

    if (!email.trim()) {
      setError("Please enter your email above, then click Forgot Password.");
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/reset-password` }
    );

    if (resetError) {
      setError(getFriendlyErrorMessage(resetError));
    } else {
      setResetSent(true);
    }
  };

  const handleCreatePassword = async (e) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSettingPassword(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ has_password: true })
        .eq("id", currentUserId);
      if (profileUpdateError) throw profileUpdateError;

      const { data: profile, error: fetchError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", currentUserId)
        .single();
      if (fetchError) throw fetchError;

      await redirectByRole(profile.role);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSettingPassword(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: "center", padding: "60px 40px" }}>
          <span className="spinner spinner-dark" role="status" aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (needsPassword) {
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

          <h1 className="brand-title">Welcome, {currentUserName}!</h1>
          <p className="brand-tagline">
            Your Google account has been verified. To enable email and
            password login, please create a password.
          </p>

          <form className="login-form" onSubmit={handleCreatePassword}>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}

            <div className="form-field">
              <label htmlFor="newPassword">New Password</label>
              <div className="password-wrapper">
                <input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPasswordStrength(calculatePasswordStrength(e.target.value));
                  }}
                  placeholder="Enter a new password"
                  disabled={settingPassword}
                  required
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowNewPassword((v) => !v)}
                  disabled={settingPassword}
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? (
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

              {newPassword && (
                <div className="strength-meter">
                  <div className="strength-bar-track">
                    <div
                      className={`strength-bar-fill strength-${passwordStrength}`}
                      style={{ width: `${(passwordStrength / 5) * 100}%` }}
                    />
                  </div>
                  <span className={`strength-label strength-text-${passwordStrength}`}>
                    {getStrengthLabel(passwordStrength)}
                  </span>
                </div>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="password-wrapper">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  disabled={settingPassword}
                  required
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  disabled={settingPassword}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? (
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

            <button type="submit" className="login-button" disabled={settingPassword}>
              {settingPassword ? (
                <span className="spinner" role="status" aria-label="Saving" />
              ) : (
                "Create Password"
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          {resetSent && (
            <div className="form-success" role="status">
              Check your email for a password reset link.
            </div>
          )}

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