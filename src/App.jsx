import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/admin/Dashboard";
import ActivityLogs from "./pages/admin/ActivityLogs";
import UserManagement from "./pages/admin/UserManagement";
import DataRecords from "./pages/admin/DataRecords";
import AlertHistory from "./pages/admin/AlertHistory";
import Reports from "./pages/admin/Reports";
import ProtectedRoute from "./routes/ProtectedRoute";
import ResetPassword from "./pages/ResetPassword";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute requiredRole="admin">
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/user-activity-logs"
          element={
            <ProtectedRoute requiredRole="admin">
              <ActivityLogs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/user-management"
          element={
            <ProtectedRoute requiredRole="admin">
              <UserManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/data-records"
          element={
            <ProtectedRoute requiredRole="admin">
              <DataRecords />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/alert-history"
          element={
            <ProtectedRoute requiredRole="admin">
              <AlertHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute requiredRole="admin">
              <Reports />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;