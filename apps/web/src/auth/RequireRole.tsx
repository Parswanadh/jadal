import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { Role } from './session';

/** Where each role belongs once it is signed in. */
export const ROLE_HOME: Record<Role, string> = {
  farmer: '/farmer',
  coordinator: '/coordinator',
};

interface RequireRoleProps {
  role: Role;
  children: ReactNode;
}

/**
 * Route guard for the two portals.
 *
 * No session: send the visitor to /login, remembering where they were headed so
 * signing in returns them there. Signed in as the other role: send them to their
 * own screen, never the one they asked for.
 */
export default function RequireRole({ role, children }: RequireRoleProps) {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (session.role !== role) {
    return <Navigate to={ROLE_HOME[session.role]} replace />;
  }

  return <>{children}</>;
}
