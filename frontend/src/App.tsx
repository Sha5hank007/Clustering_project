import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { token, user } = useAuth();

  return (
    <div className="app-shell">
      {token && <Navbar />}
      <main className="app-main"><Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/ingest" element={<ProtectedRoute><IngestPage /></ProtectedRoute>} />
        <Route path="/persons" element={<ProtectedRoute><PersonsPage /></ProtectedRoute>} />
        <Route path="/persons/:id" element={<ProtectedRoute><PersonDetailPage /></ProtectedRoute>} />
        <Route path="/identify" element={<ProtectedRoute><IdentifyPage /></ProtectedRoute>} />
        <Route path="/streams" element={<ProtectedRoute><StreamsPage /></ProtectedRoute>} />
        <Route path="/cameras" element={<ProtectedRoute>{user?.role === 'admin' || user?.role === 'manager' ? <CamerasPage /> : <Navigate to="/" replace />}</ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
