import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import IngestPage from './pages/IngestPage';
import PersonsPage from './pages/PersonsPage';
import PersonDetailPage from './pages/PersonDetailPage';
import IdentifyPage from './pages/IdentifyPage';
import StreamsPage from './pages/StreamsPage';
import AdminPage from './pages/AdminPage';
import CamerasPage from './pages/CamerasPage';
import SuperadminPage from './pages/SuperadminPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordRecoveryPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role === 'superadmin' && !location.pathname.startsWith('/superadmin')) {
    return <Navigate to="/superadmin" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { token, user } = useAuth();
  const home = user?.role === 'superadmin' ? '/superadmin' : '/';

  return (
    <div className="app-shell">
      {token && <Navbar />}
      <main className="app-main"><Routes>
        <Route path="/login" element={token ? <Navigate to={home} replace /> : <LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={<ProtectedRoute>{user?.role === 'superadmin' ? <Navigate to="/superadmin" replace /> : <DashboardPage />}</ProtectedRoute>} />
        <Route path="/ingest" element={<ProtectedRoute><IngestPage /></ProtectedRoute>} />
        <Route path="/persons" element={<ProtectedRoute><PersonsPage /></ProtectedRoute>} />
        <Route path="/persons/:id" element={<ProtectedRoute><PersonDetailPage /></ProtectedRoute>} />
        <Route path="/identify" element={<ProtectedRoute><IdentifyPage /></ProtectedRoute>} />
        <Route path="/streams" element={<ProtectedRoute><StreamsPage /></ProtectedRoute>} />
        <Route path="/cameras" element={<ProtectedRoute>{user?.role === 'admin' || user?.role === 'manager' ? <CamerasPage /> : <Navigate to="/" replace />}</ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute>{user?.role === 'admin' || user?.role === 'manager' ? <AdminPage /> : <Navigate to={home} replace />}</ProtectedRoute>} />
        <Route path="/superadmin" element={<ProtectedRoute>{user?.role === 'superadmin' ? <SuperadminPage /> : <Navigate to="/" replace />}</ProtectedRoute>} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes></main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
