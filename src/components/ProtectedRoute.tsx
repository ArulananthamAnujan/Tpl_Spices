import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../lib/types';
import LoadingSpinner from './LoadingSpinner';

interface Props {
  children: React.ReactNode;
  requiredRole?: UserRole;
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tpl-cream">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (requiredRole && profile?.role !== requiredRole) {
    if (requiredRole === 'super_admin' && profile?.role !== 'super_admin') {
      return <Navigate to="/" replace />;
    }
    if (requiredRole === 'staff' && profile?.role !== 'staff' && profile?.role !== 'super_admin') {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}
