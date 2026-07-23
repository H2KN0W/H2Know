import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Bell,
  ClipboardList,
  Database,
  FileText,
  Users,
  Menu,
  X,
} from "lucide-react";
import LogoutButton from "./LogoutButton";
import H2knowLogo from "../assets/img/H2knowlogo.jpg";
import "../styles/Sidebar.css";

const navSections = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Alert History", path: "/admin/alert-history", icon: Bell },
      { label: "Activity Logs", path: "/admin/user-activity-logs", icon: ClipboardList },
      { label: "Data Records", path: "/admin/data-records", icon: Database },
      { label: "Reports", path: "/admin/reports", icon: FileText },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "User Management", path: "/admin/user-management", icon: Users }],
  },
];

/**
 * Shared admin sidebar.
 * Desktop: fixed, full-height rail.
 * Tablet/mobile (<=1024px): collapses behind a top bar + hamburger,
 * opens as an off-canvas panel over a scrim.
 */
const Sidebar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="sidebar-topbar">
        <button
          type="button"
          className="sidebar-hamburger"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu size={19} />
        </button>
        <div className="sidebar-topbar-brand">
          <img src={H2knowLogo} alt="H2KNOW logo" />
          <span>H2KNOW</span>
        </div>
      </div>

      {mobileOpen && (
        <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`admin-sidebar${mobileOpen ? " is-open" : ""}`}>
        <div className="sidebar-brand">
          <img src={H2knowLogo} alt="H2KNOW logo" className="sidebar-logo" />
          <div>
            <p className="sidebar-title">H2KNOW</p>
            <p className="sidebar-subtitle">Admin Panel</p>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div className="sidebar-section" key={section.label}>
              <p className="sidebar-nav-label">{section.label}</p>
              {section.items.map(({ label, path, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    isActive ? "sidebar-link active" : "sidebar-link"
                  }
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon size={17} strokeWidth={2} className="sidebar-link-icon" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <LogoutButton />
        </div>
      </aside>
    </>
  );
};

export default Sidebar;