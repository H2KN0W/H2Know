import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "../styles/Login.css";
import H2knowLogo from "../assets/img/H2knowlogo.jpg";

const ResetPassword = () => {
  const navigate = useNavigate();

  const [checkingSession, setCheckingSession] = useState(true);
  const [validSession, setValidSession] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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

  // The password reset link from the email logs the user into a temporary
  // session automatically — we just need to confirm that session exists.
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setValidSession(Boolean(session));
      setCheckingSession(false);
    };
    checkSession();
  }, []);

  const handleSubmit = async (e) => {
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

    setSaving(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      // Ensure has_password is true (covers Google users resetting for the first time)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ has_password: true })
          .eq("id", user.id);
      }

      setSuccess(true);
      setTimeout(() => navigate("/"), 2500);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
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

  if (!validSession) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="logo-wrap">
            <img src={H2knowLogo} alt="H2KNOW logo" className="logo-img" />
          </div>
          <h1 className="brand-title">Link Expired</h1>
          <p className="brand-tagline">
            This password reset link is invalid or has expired. Please
            request a new one from the login page.
          </p>
          <button className="login-button" onClick={() => navigate("/")}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="logo-wrap">
            <img src={H2knowLogo} alt="H2KNOW logo" className="logo-img" />
          </div>
          <h1 className="brand-title">Password Updated</h1>
          <p className="brand-tagline">
            Your password has been reset successfully. Redirecting you to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo-wrap">
          <img src={H2knowLogo} alt="H2KNOW logo" className="logo-img" />
        </div>

        <h1 className="brand-title">Reset Your Password</h1>
        <p className="brand-tagline">
          Enter a new password for your H2KNOW account.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
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
                disabled={saving}
                required
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowNewPassword((v) => !v)}
                disabled={saving}
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
                disabled={saving}
                required
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowConfirmPassword((v) => !v)}
                disabled={saving}
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

          <button type="submit" className="login-button" disabled={saving}>
            {saving ? (
              <span className="spinner" role="status" aria-label="Saving" />
            ) : (
              "Reset Password"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;