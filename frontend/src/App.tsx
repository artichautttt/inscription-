import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Header from './components/Header';
import Login from './components/Login';
import Register from './components/Register';
import Catalogue from './components/Catalogue';
import MesInscriptions from './components/MesInscriptions';
import AdminCourses from './components/AdminCourses';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  const { user } = useAuth();

  // Destination par défaut selon le rôle
  const home = user?.role === 'ADMIN' ? '/admin' : '/catalogue';

  return (
    <div className="app">
      <Header />

      <main className="app-main">
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to={home} replace /> : <Login />}
          />
          <Route
            path="/register"
            element={user ? <Navigate to={home} replace /> : <Register />}
          />

          <Route
            path="/catalogue"
            element={
              <ProtectedRoute>
                <Catalogue />
              </ProtectedRoute>
            }
          />

          <Route
            path="/mes-inscriptions"
            element={
              <ProtectedRoute roles={['ELEVE']}>
                <MesInscriptions />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <AdminCourses />
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<Navigate to={user ? home : '/login'} replace />} />
          <Route path="*" element={<Navigate to={user ? home : '/login'} replace />} />
        </Routes>
      </main>
    </div>
  );
}
