import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import "../../styles/UserManagement.css";
import Sidebar from "../../components/Sidebar";
import { useLogPageView } from "../../lib/useLogPageView";
import { logActivity } from "../../lib/logActivity";
import { Plus, Pencil, Ban, CircleCheck, Trash2 } from "lucide-react";

const PAGE_SIZE = 5;

const formatDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// status column in DB: 'pending' | 'approved' | 'rejected'
// wireframe labels: Pending | Active | Disabled
const statusToLabel = (status) => {
  if (status === "approved") return "Active";
  if (status === "rejected") return "Disabled";
  return "Pending";
};

const UserManagement = () => {
  useLogPageView("Viewed User Management");

  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [modalUser, setModalUser] = useState(null); // profile being edited, or {} for "add"
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null);
  const [currentAdmin, setCurrentAdmin] = useState(null);

  const fetchProfiles = async () => {
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, status, has_password, last_login, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("Could not load users.");
    } else {
      setProfiles(data);
    }
    setLoading(false);
  };

  const fetchCurrentAdmin = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", session.user.id)
      .single();
    setCurrentAdmin(data);
  };

  useEffect(() => {
    fetchProfiles();
    fetchCurrentAdmin();
  }, []);

  const summary = useMemo(() => {
    return {
      total: profiles.length,
      active: profiles.filter((p) => p.status === "approved").length,
      disabledPending: profiles.filter(
        (p) => p.status === "rejected" || p.status === "pending"
      ).length,
    };
  }, [profiles]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter(
      (p) =>
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.email?.toLowerCase().includes(search.toLowerCase())
    );
  }, [profiles, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProfiles.length / PAGE_SIZE));
  const pagedProfiles = filteredProfiles.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const updateProfile = async (id, updates) => {
    setActionError("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      setActionError(updateError.message);
      return false;
    }

    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
    return true;
  };

  const logAdminAction = async (activityText) => {
    if (!currentAdmin) return;
    await logActivity({
      user_id: currentAdmin.id,
      full_name: currentAdmin.full_name,
      role: currentAdmin.role,
      activity: activityText,
      status: "Success",
    });
  };

  const handleToggleDisable = async (p) => {
    const newStatus = p.status === "approved" ? "rejected" : "approved";
    const ok = await updateProfile(p.id, { status: newStatus });
    if (ok) {
      await logAdminAction(
        `${newStatus === "approved" ? "Enabled" : "Disabled"} account: ${p.full_name}`
      );
    }
  };

  const handleDeleteConfirmed = async () => {
    setActionError("");

    // Try deleting via Edge Function (removes from auth.users + profiles)
    const { data, error: fnError } = await supabase.functions.invoke("manage-user", {
      body: { action: "delete", user_id: confirmDeleteUser.id },
    });

    let deleteFailed = false;

    if (fnError || data?.error) {
      // If Edge Function is not deployed or fails, fallback to direct profiles table deletion
      const { error: dbError } = await supabase
        .from("profiles")
        .delete()
        .eq("id", confirmDeleteUser.id);

      if (dbError) {
        setActionError(data?.error || fnError?.message || dbError.message);
        deleteFailed = true;
      }
    }

    if (!deleteFailed) {
      await logAdminAction(`Removed user: ${confirmDeleteUser.full_name}`);
      setProfiles((prev) => prev.filter((p) => p.id !== confirmDeleteUser.id));
      setConfirmDeleteUser(null);
    }
  };

  const handleModalSave = async (formData, isNewUser) => {
    if (isNewUser) {
      const { data, error: fnError } = await supabase.functions.invoke("manage-user", {
        body: {
          action: "create",
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          role: formData.role,
        },
      });

      if (fnError || data?.error) {
        return { success: false, error: data?.error || fnError.message };
      }

      await logAdminAction(`Added new user: ${formData.full_name}`);
      await fetchProfiles();
      return { success: true };
    }

    // Existing user: role always goes through the normal profiles update.
    const ok = await updateProfile(modalUser.id, {
      full_name: formData.full_name,
      role: formData.role,
    });

    if (!ok) {
      return { success: false, error: actionError || "Could not save changes." };
    }

    // Only call the Edge Function if the email actually changed.
    if (formData.email && formData.email !== modalUser.email) {
      const { data, error: fnError } = await supabase.functions.invoke("manage-user", {
        body: {
          action: "update_email",
          user_id: modalUser.id,
          new_email: formData.email,
        },
      });

      if (fnError || data?.error) {
        return { success: false, error: data?.error || fnError.message };
      }

      setProfiles((prev) =>
        prev.map((p) => (p.id === modalUser.id ? { ...p, email: formData.email } : p))
      );
    }

    await logAdminAction(`Edited user: ${formData.full_name}`);
    return { success: true };
  };

  return (
    <div className="admin-shell">
      <Sidebar />

      <main className="admin-main">
        <header className="page-header">
          <h1>User Management</h1>
          <p>Manage system users and their access permissions</p>
        </header>

        <div className="um-toolbar-top">
          <input
            type="text"
            className="um-search"
            placeholder="Search users by name or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <button
            className="um-add-btn"
            onClick={() => setModalUser({})}
          >
            <Plus size={16} strokeWidth={2.5} />
            Add New User
          </button>
        </div>

        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-card-body">
              <p className="summary-label">Total Users</p>
              <p className="summary-value tone-neutral">{summary.total}</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-body">
              <p className="summary-label">Active Users</p>
              <p className="summary-value tone-positive">{summary.active}</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-body">
              <p className="summary-label">Disabled/Pending Users</p>
              <p className="summary-value tone-warning">{summary.disabledPending}</p>
            </div>
          </div>
        </div>

        <section className="panel">
          <h2>All Users</h2>

          {actionError && <p className="um-action-error">{actionError}</p>}
          {loading && <p>Loading users...</p>}
          {error && <p className="um-action-error">{error}</p>}

          {!loading && !error && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last Login</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProfiles.length === 0 && (
                      <tr>
                        <td colSpan={6}>No users match your search.</td>
                      </tr>
                    )}
                    {pagedProfiles.map((p) => {
                      const isActive = p.status === "approved";
                      return (
                        <tr key={p.id}>
                          <td>{p.full_name || "—"}</td>
                          <td>{p.email}</td>
                          <td>{p.role === "admin" ? "Administrator" : "Manager"}</td>
                          <td>
                            <span
                              className={`badge um-status-${p.status}`}
                            >
                              {statusToLabel(p.status)}
                            </span>
                          </td>
                          <td>{formatDateTime(p.last_login)}</td>
                          <td className="um-actions-icons">
                            <button
                              className="um-icon-btn um-icon-edit"
                              title="Edit"
                              aria-label="Edit user"
                              onClick={() => setModalUser(p)}
                            >
                              <Pencil size={15} strokeWidth={2} />
                            </button>
                            <button
                              className={`um-icon-btn ${isActive ? "um-icon-disable" : "um-icon-enable"}`}
                              title={isActive ? "Disable" : "Enable"}
                              aria-label={isActive ? "Disable user" : "Enable user"}
                              onClick={() => handleToggleDisable(p)}
                            >
                              {isActive ? (
                                <Ban size={15} strokeWidth={2} />
                              ) : (
                                <CircleCheck size={15} strokeWidth={2} />
                              )}
                            </button>
                            <button
                              className="um-icon-btn um-icon-danger"
                              title="Delete"
                              aria-label="Delete user"
                              onClick={() => setConfirmDeleteUser(p)}
                            >
                              <Trash2 size={15} strokeWidth={2} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="um-pagination">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      className={n === page ? "um-page-active" : ""}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {modalUser && (
        <UserModal
          user={modalUser}
          onCancel={() => setModalUser(null)}
          onClose={() => setModalUser(null)}
          onSave={handleModalSave}
        />
      )}

      {confirmDeleteUser && (
        <div className="um-modal-overlay" onClick={() => setConfirmDeleteUser(null)}>
          <div className="um-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Remove User</h2>
            <p>
              Are you sure you want to remove <strong>{confirmDeleteUser.full_name}</strong>?
              This action cannot be undone.
            </p>
            <div className="um-modal-actions">
              <button className="um-modal-cancel" onClick={() => setConfirmDeleteUser(null)}>
                Cancel
              </button>
              <button className="um-modal-danger" onClick={handleDeleteConfirmed}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const UserModal = ({ user, onCancel, onSave, onClose }) => {
  const isNewUser = !user.id;
  const [fullName, setFullName] = useState(user.full_name || "");
  const [email, setEmail] = useState(user.email || "");
  const [role, setRole] = useState(user.role || "manager");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setValidationError("");

    if (!fullName.trim()) {
      setValidationError("Full name is required.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      setValidationError("Please enter a valid email address (e.g. name@h2know.com).");
      return;
    }

    if (isNewUser && !password) {
      setValidationError("Password is required for new users.");
      return;
    }

    setSaving(true);
    const result = await onSave({ full_name: fullName, email, role, password }, isNewUser);
    setSaving(false);

    if (!result.success) {
      setValidationError(result.error);
      return;
    }

    setSaved(true);
    setTimeout(() => {
      onClose();
    }, 1100);
  };

  return (
    <div className="um-modal-overlay" onClick={saving ? undefined : onCancel}>
      <div className="um-modal" onClick={(e) => e.stopPropagation()}>
        {saved ? (
          <div className="um-modal-success">
            <div className="um-modal-success-check">✓</div>
            <p>{isNewUser ? "User created successfully" : "Changes saved successfully"}</p>
          </div>
        ) : (
          <>
            <h2>{isNewUser ? "Add User" : "Edit User"}</h2>

            {validationError && (
              <div className="um-modal-error">
                <span className="um-modal-error-icon">!</span>
                <span>{validationError}</span>
              </div>
            )}

            <label className="um-modal-label">Full Name</label>
            <input
              className="um-modal-input"
              placeholder="Enter full name..."
              value={fullName}
              disabled={saving}
              onChange={(e) => setFullName(e.target.value)}
            />

            <label className="um-modal-label">Email</label>
            <input
              className="um-modal-input"
              placeholder="Enter email address..."
              value={email}
              disabled={saving}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label className="um-modal-label">Role</label>
            <select
              className="um-modal-input"
              value={role}
              disabled={saving}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
            </select>

            {isNewUser && (
              <>
                <label className="um-modal-label">Password</label>
                <input
                  className="um-modal-input"
                  type="password"
                  placeholder="Enter a password for this user..."
                  value={password}
                  disabled={saving}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            )}

            <div className="um-modal-actions">
              <button className="um-modal-cancel" onClick={onCancel} disabled={saving}>
                Cancel
              </button>
              <button className="um-modal-save" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <span className="um-modal-save-loading">
                    <span className="spinner" role="status" aria-label="Saving" />
                    Saving...
                  </span>
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UserManagement;