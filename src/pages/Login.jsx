import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "../styles/Login.css";
import H2knowLogo from "../assets/img/H2knowLogo.jpg";
import { logActivity } from "../lib/logActivity";
import { Lock, CheckCircle, AlertCircle } from "lucide-react";
import loginCoverVideo from "../assets/video/h2knowLoginCoverSide.mp4";

const REMEMBER_KEY = "h2know_remembered_email";

/* ─────────────────────────────────────────────
   LEFT PANEL — branding / video background
───────────────────────────────────────────── */
const BrandPanel = () => (
  <div className="lp-brand" aria-hidden="true">
    {/* Video background */}
    <video
      className="lp-brand-video"
      src={loginCoverVideo}
      autoPlay
      loop
      muted
      playsInline
    />

    {/* Dark overlay so text stays readable */}
    <div className="lp-brand-overlay" />

    {/* Brand content */}
    <div className="lp-brand-content">
      <div className="lp-logo-wrap">
        <img
          src={H2knowLogo}
          alt="H2KNOW logo"
          className="lp-logo-img"
          onError={(e) => {
            e.target.style.display = "none";
            e.target.nextSibling.style.display = "flex";
          }}
        />
        <div className="lp-logo-fallback">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M24 4C24 4 10 20.5 10 30.5C10 38.5 16.3 44 24 44C31.7 44 38 38.5 38 30.5C38 20.5 24 4 24 4Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>

      <h1 className="lp-brand-title">
        H<sub>2</sub>KNOW
      </h1>
      <p className="lp-brand-tagline">Know the Flow, Before You Go.</p>
      <p className="lp-brand-desc">
        Dynamic water quality monitoring for smarter and safer water management.
      </p>

      {/* Decorative sensor / metric pills */}
      <div className="lp-metric-pills">
        <span className="lp-pill">
          <span className="lp-pill-dot" />
          Live Sensors
        </span>
        <span className="lp-pill">
          <span className="lp-pill-dot" />
           Active Alerts
        </span>
        <span className="lp-pill">
          <span className="lp-pill-dot" />
          Water Analytics
        </span>
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────────
   MAIN LOGIN COMPONENT
───────────────────────────────────────────── */
const Login = () => {
  const navigate = useNavigate();

  // ── State (unchanged from original) ──────────────────────────────────────
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
  const [notice, setNotice] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [resetSent, setResetSent] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserName, setCurrentUserName] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);

  // ── Password strength (unchanged) ────────────────────────────────────────
  const passwordStrength = (() => {
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (newPassword.length >= 12) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;
    return score;
  })();

  const strengthLabel =
    passwordStrength <= 1 ? "Weak" : passwordStrength <= 3 ? "Medium" : "Strong";

  // ── Error mapping (unchanged) ─────────────────────────────────────────────
  const getFriendlyErrorMessage = (err) => {
    const message = err?.message || "";
    if (message.includes("Invalid login credentials"))
      return "Invalid email or password.";
    if (message.includes("Email not confirmed"))
      return "Please confirm your email address before logging in.";
    if (message.toLowerCase().includes("too many"))
      return "Too many login attempts. Please wait a moment and try again.";
    if (message.includes("network"))
      return "Network error. Please check your connection and try again.";
    return message || "Something went wrong. Please try again.";
  };

  // ── Role redirect (unchanged) ─────────────────────────────────────────────
  const redirectByRole = async (role) => {
    const normalizedRole = String(role || "").trim().toLowerCase();
    if (normalizedRole === "admin") {
      navigate("/admin/dashboard", { replace: true });
      return;
    }
    if (normalizedRole === "manager") {
      navigate("/manager/dashboard", { replace: true });
      return;
    }
    setError("You do not have access to this dashboard.");
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  // ── Profile verification (unchanged) ──────────────────────────────────────
  const verifyAccess = async (userId) => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, status, has_password, full_name")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Failed to verify account profile:", profileError);
      await supabase.auth.signOut();
      throw new Error(
        "Could not check your account profile. Please try again or contact an administrator."
      );
    }
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error(
        "No H2KNOW profile was found for this Google account. Please ask an administrator to check or approve your account."
      );
    }
    if (profile.status === "pending") {
      await supabase.auth.signOut();
      const pendingError = new Error(
        "Your Google account is registered and awaiting admin approval. You can sign in with Google once it is approved."
      );
      pendingError.code = "ACCOUNT_PENDING";
      throw pendingError;
    }
    if (profile.status === "rejected") {
      await supabase.auth.signOut();
      throw new Error(
        "Your account access was denied. Please contact an administrator."
      );
    }
    return profile;
  };

  // ── Session check on mount (unchanged) ────────────────────────────────────
  useEffect(() => {
    const checkOAuthSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

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
          setCurrentUserRole(profile.role);
          setNeedsPassword(true);
          setGoogleLoading(false);
          setCheckingSession(false);
          return;
        }

        await redirectByRole(profile.role);
      } catch (err) {
        if (err.code === "ACCOUNT_PENDING") setNotice(err.message);
        else setError(err.message);
        setGoogleLoading(false);
        setCheckingSession(false);
      }
    };

    checkOAuthSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Email/password submit (unchanged) ─────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
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

      await supabase
        .from("profiles")
        .update({ last_login: new Date().toISOString() })
        .eq("id", data.user.id);

      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }

      await redirectByRole(profile.role);
    } catch (err) {
      if (err.code === "ACCOUNT_PENDING") {
        setNotice(err.message);
      } else {
        await logActivity({
          user_id: null,
          full_name: "Unknown",
          role: null,
          activity: "Login Attempt",
          status: "Failed",
        });
        setError(getFriendlyErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth (unchanged) ───────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setError("");
    setNotice("");
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

  // ── Forgot password (unchanged) ───────────────────────────────────────────
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
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

  // ── Create password (unchanged) ───────────────────────────────────────────
  const handleCreatePassword = async (event) => {
    event.preventDefault();
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
      const { error: passwordError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (passwordError) throw passwordError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ has_password: true })
        .eq("id", currentUserId);
      if (profileError) throw profileError;

      await redirectByRole(currentUserRole);
    } catch (passwordError) {
      setError(getFriendlyErrorMessage(passwordError));
    } finally {
      setSettingPassword(false);
    }
  };

  // ── Eye icon SVGs (reused) ────────────────────────────────────────────────
  const EyeOff = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.5 5.3A10.4 10.4 0 0112 5c5 0 9 4 10 7-.4 1.1-1.1 2.3-2.1 3.4M6.2 6.6C4.3 8 3 9.9 2 12c1 3 5 7 10 7 1.4 0 2.7-.3 3.9-.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const EyeOn = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Session check loading screen
  // ─────────────────────────────────────────────────────────────────────────
  if (checkingSession) {
    return (
      <div className="lp-loading-screen" role="status" aria-label="Initializing H2KNOW">
        <div className="lp-loading-inner">
          {/* Ripple rings behind logo */}
          <div className="lp-loading-ripple">
            <span className="lp-lr-ring lp-lr-ring-1" />
            <span className="lp-lr-ring lp-lr-ring-2" />
            <span className="lp-lr-ring lp-lr-ring-3" />
            <div className="lp-loading-logo-wrap">
              <img
                src={H2knowLogo}
                alt="H2KNOW"
                className="lp-loading-logo"
                onError={(e) => {
                  e.target.style.display = "none";
                  e.target.nextSibling.style.display = "flex";
                }}
              />
              <div className="lp-loading-logo-fallback">
                <svg viewBox="0 0 48 48" fill="none">
                  <path
                    d="M24 4C24 4 10 20.5 10 30.5C10 38.5 16.3 44 24 44C31.7 44 38 38.5 38 30.5C38 20.5 24 4 24 4Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
            </div>
          </div>
          <p className="lp-loading-title">
            H<sub>2</sub>KNOW
          </p>
          <div className="lp-loading-spinner" aria-hidden="true" />
          <p className="lp-loading-text">Initializing session…</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Create Password screen (first-time Google user)
  // ─────────────────────────────────────────────────────────────────────────
  if (needsPassword) {
    return (
      <div className="lp-root">
        <BrandPanel />

        <div className="lp-form-panel">
          <div className="lp-form-inner">
            {/* Mobile-only compact brand */}
            <div className="lp-mobile-brand">
              <div className="lp-mobile-logo-wrap">
                <img
                  src={H2knowLogo}
                  alt="H2KNOW"
                  className="lp-mobile-logo"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              </div>
              <span className="lp-mobile-title">
                H<sub>2</sub>KNOW
              </span>
            </div>

            <h2 className="lp-form-heading">Create Your Password</h2>
            <p className="lp-form-subheading">
              Hi <strong>{currentUserName}</strong>! Set a password to finish setting
              up your H2KNOW account.
            </p>

            <form className="lp-form" onSubmit={handleCreatePassword}>
              {error && (
                <div className="lp-alert lp-alert-error" role="alert">
                  <AlertCircle size={15} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              {/* New password */}
              <div className="lp-field">
                <label htmlFor="new-password">Create password</label>
                <div className="lp-input-wrap">
                  <input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={settingPassword}
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    onClick={() => setShowNewPassword((v) => !v)}
                    disabled={settingPassword}
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                  >
                    {showNewPassword ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
                {newPassword && (
                  <div className="lp-strength" aria-live="polite">
                    <div
                      className="lp-strength-track"
                      aria-label={`Password strength: ${strengthLabel}`}
                    >
                      <div
                        className={`lp-strength-fill lp-strength-${passwordStrength}`}
                        style={{ width: `${(passwordStrength / 5) * 100}%` }}
                      />
                    </div>
                    <span className={`lp-strength-label lp-st-${passwordStrength}`}>
                      {strengthLabel}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="lp-field">
                <label htmlFor="confirm-password">Confirm password</label>
                <div className="lp-input-wrap">
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={settingPassword}
                    aria-describedby={confirmPassword ? "pw-match-status" : undefined}
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    disabled={settingPassword}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
                {confirmPassword && (
                  <span
                    id="pw-match-status"
                    className={`lp-match ${
                      newPassword === confirmPassword
                        ? "lp-match-ok"
                        : "lp-match-err"
                    }`}
                    role="status"
                  >
                    {newPassword === confirmPassword
                      ? "Passwords match"
                      : "Passwords do not match"}
                  </span>
                )}
              </div>

              <button
                type="submit"
                className="lp-submit-btn"
                disabled={settingPassword}
              >
                {settingPassword ? (
                  <span className="lp-spinner lp-spinner-white" aria-label="Saving password" role="status" />
                ) : (
                  "Save Password & Continue"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Main login screen
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="lp-root">
      <BrandPanel />

      <div className="lp-form-panel">
        <div className="lp-form-inner">
          {/* Mobile-only compact brand header */}
          <div className="lp-mobile-brand">
            <div className="lp-mobile-logo-wrap">
              <img
                src={H2knowLogo}
                alt="H2KNOW"
                className="lp-mobile-logo"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            </div>
            <span className="lp-mobile-title">
              H<sub>2</sub>KNOW
            </span>
          </div>

          {/* Form heading */}
          <h2 className="lp-form-heading">Welcome Back</h2>
          <p className="lp-form-subheading">Sign in to your H2KNOW account.</p>

          {/* Security badge */}
          <div className="lp-security-badge">
            <Lock size={12} aria-hidden="true" />
            <span>Authorized Personnel</span>
          </div>

          <form className="lp-form" onSubmit={handleSubmit} noValidate>
            {/* Notices */}
            {notice && (
              <div className="lp-alert lp-alert-success" role="status">
                <CheckCircle size={15} aria-hidden="true" />
                <span>{notice}</span>
              </div>
            )}
            {resetSent && (
              <div className="lp-alert lp-alert-success" role="status">
                <CheckCircle size={15} aria-hidden="true" />
                <span>Check your email for a password reset link.</span>
              </div>
            )}
            {error && (
              <div className="lp-alert lp-alert-error" role="alert">
                <AlertCircle size={15} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Email */}
            <div className="lp-field">
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

            {/* Password */}
            <div className="lp-field">
              <label htmlFor="password">Password</label>
              <div className="lp-input-wrap">
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
                  className="lp-eye-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading || googleLoading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff /> : <EyeOn />}
                </button>
              </div>
            </div>

            {/* Remember me + Forgot password */}
            <div className="lp-form-row">
              <label className="lp-checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading || googleLoading}
                />
                <span>Remember me</span>
              </label>
              <a
                href="#"
                className="lp-forgot-link"
                onClick={handleForgotPassword}
              >
                Forgot Password?
              </a>
            </div>

            {/* Sign in button */}
            <button
              type="submit"
              className="lp-submit-btn"
              disabled={loading || googleLoading}
            >
              {loading ? (
                <span
                  className="lp-spinner lp-spinner-white"
                  role="status"
                  aria-label="Signing in"
                />
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="lp-divider">
            <span>or</span>
          </div>

          {/* Google login */}
          <button
            type="button"
            className="lp-google-btn"
            onClick={handleGoogleLogin}
            disabled={loading || googleLoading}
          >
            {googleLoading ? (
              <span
                className="lp-spinner lp-spinner-blue"
                role="status"
                aria-label="Connecting to Google"
              />
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 01-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A11.99 11.99 0 0012 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.29a7.2 7.2 0 010-4.58v-3.1H1.26a12 12 0 000 10.78l4.01-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z"
                  />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
