import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { clearSession, passwordMatches, readSession, writeSession } from './session';
import type { Role, Session } from './session';

interface AuthValue {
  session: Session | null;
  role: Role | null;
  /** True when the password matches the configured one for that role. */
  signIn: (role: Role, password: string) => boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());

  const signIn = useCallback((role: Role, password: string): boolean => {
    if (!passwordMatches(role, password)) return false;
    const next: Session = { role, signedInAt: new Date().toISOString() };
    writeSession(next);
    setSession(next);
    return true;
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ session, role: session?.role ?? null, signIn, signOut }),
    [session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
