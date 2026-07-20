import { useEffect, useState, useMemo } from "react";
import { NavLink } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import "../../styles/UserManagement.css";
import H2knowLogo from "../../assets/img/H2knowlogo.jpg";
import LogoutButton from "../../components/LogoutButton";
import { useLogPageView } from "../../lib/useLogPageView";
import { logActivity } from "../../lib/logActivity";

const navItems = [
  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Alert History", path: "/admin/alert-history" },
  { label: "Activity Logs", path: "/admin/user-activity-logs" },
  { label: "Data Records", path: "/admin/data-records" },
  { label: "Reports", path: "/admin/reports" },
  { label: "User Management", path: "/admin/user-management" },
];

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
    
    const { error: deleteError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", confirmDeleteUser.id);

    if (deleteError) {
      setActionError(deleteError.message);
      return;
    }

    await logAdminAction(`Removed user: ${confirmDeleteUser.full_name}`);
    setProfiles((prev) => prev.filter((p) => p.id !== confirmDeleteUser.id));
    setConfirmDeleteUser(null);
  };

  const handleModalSave = async (formData, isNewUser) => {
    if (isNewUser) {
      setActionError(
        "Add New User requires a server-side Edge Function (Supabase Admin API) to create the login account — not built yet. Ask to build this next."
      );
      return;
    }

    const ok = await updateProfile(modalUser.id, {
      full_name: formData.full_name,
      role: formData.role,
    });

    if (ok) {
      await logAdminAction(`Edited user: ${formData.full_name}`);
      setModalUser(null);
    }
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <img src={H2knowLogo} alt="H2KNOW logo" className="sidebar-logo" />
          <div>
            <p className="sidebar-title">
              H<sub>2</sub>KNOW
            </p>
            <p className="sidebar-subtitle">Admin Panel</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Menu</p>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <LogoutButton />
      </aside>

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
            + Add New User
          </button>
        </div>

        <div className="summary-grid">
          <div className="summary-card">
            <p className="summary-label">Total Users</p>
            <p className="summary-value tone-neutral">{summary.total}</p>
          </div>
          <div className="summary-card">
            <p className="summary-label">Active Users</p>
            <p className="summary-value tone-positive">{summary.active}</p>
          </div>
          <div className="summary-card">
            <p className="summary-label">Disabled/Pending Users</p>
            <p className="summary-value tone-warning">{summary.disabledPending}</p>
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
                    {pagedProfiles.map((p) => (
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
                            className="um-icon-btn"
                            title="Edit"
                            onClick={() => setModalUser(p)}
                          >
                            ✏️
                          </button>
                          <button
                            className="um-icon-btn"
                            title={p.status === "approved" ? "Disable" : "Enable"}
                            onClick={() => handleToggleDisable(p)}
                          >
                            🚫
                          </button>
                          <button
                            className="um-icon-btn um-icon-danger"
                            title="Delete"
                            onClick={() => setConfirmDeleteUser(p)}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
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

const UserModal = ({ user, onCancel, onSave }) => {
  const isNewUser = !user.id;
  const [fullName, setFullName] = useState(user.full_name || "");
  const [email, setEmail] = useState(user.email || "");
  const [role, setRole] = useState(user.role || "manager");
  const [password, setPassword] = useState("");

  return (
    <div className="um-modal-overlay" onClick={onCancel}>
      <div className="um-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isNewUser ? "Add User" : "Edit User"}</h2>

        <label className="um-modal-label">Full Name</label>
        <input
          className="um-modal-input"
          placeholder="Enter full name..."
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <label className="um-modal-label">Email</label>
        <input
          className="um-modal-input"
          placeholder="Enter email address..."
          value={email}
          disabled={!isNewUser}
          onChange={(e) => setEmail(e.target.value)}
        />
        {!isNewUser && (
          <p className="um-modal-note">
            Email can't be changed here yet — requires the Supabase Admin API.
          </p>
        )}

        <label className="um-modal-label">Role</label>
        <select
          className="um-modal-input"
          value={role}
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
              placeholder="Enter password or leave blank to keep..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="um-modal-note">
              Creating a new user requires a server-side Edge Function — not built yet.
            </p>
          </>
        )}

        <div className="um-modal-actions">
          <button className="um-modal-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="um-modal-save"
            onClick={() => onSave({ full_name: fullName, email, role, password }, isNewUser)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;