import { useState } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, Bell, LayoutDashboard, FileText, Menu, X } from "lucide-react";
import LogoutButton from "../../components/LogoutButton";
import H2knowLogo from "../../assets/img/H2knowLogo.jpg";
import "../../styles/Sidebar.css";

const items = [
  { label: "Dashboard", path: "/manager/dashboard", icon: LayoutDashboard },
  { label: "Analytics & Trends", path: "/manager/analytics", icon: BarChart3 },
  { label: "Alerts", path: "/manager/alerts", icon: Bell },
  { label: "Reports", path: "/manager/reports", icon: FileText },
];

const ManagerSidebar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="sidebar-topbar">
        <button type="button" className="sidebar-hamburger" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
        <div className="sidebar-topbar-brand"><img src={H2knowLogo} alt="H2KNOW logo" /><span>H2KNOW</span></div>
      </div>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`admin-sidebar manager-sidebar${mobileOpen ? " is-open" : ""}`}>
        <div className="sidebar-brand">
          <img src={H2knowLogo} alt="H2KNOW logo" className="sidebar-logo" />
          <div><p className="sidebar-title">H2KNOW</p><p className="sidebar-subtitle">Manager Portal</p></div>
          <button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>
        <nav className="sidebar-nav"><div className="sidebar-section"><p className="sidebar-nav-label">Monitoring</p>
          {items.map(({ label, path, icon: Icon }) => <NavLink key={path} to={path} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"} onClick={() => setMobileOpen(false)}><Icon size={17} strokeWidth={2} className="sidebar-link-icon" /><span>{label}</span></NavLink>)}
        </div></nav>
        <div className="sidebar-footer"><LogoutButton /></div>
      </aside>
    </>
  );
};

export default ManagerSidebar;
