// Session storage and password checks for the client-side role gate.
//
// The gate is deliberately client-side (see .ref/session/spec-auth-data-video.md):
// there is no user table and no server-side auth. Passwords come from Vite env
// vars with documented, non-secret defaults so the app runs with zero config.

export type Role = 'farmer' | 'coordinator';

export interface Session {
  role: Role;
  signedInAt: string;
}

/** The one key the session is persisted under. */
export const SESSION_KEY = 'jadal.session';

/**
 * Non-secret defaults, documented in apps/web/README.md. Override them with
 * VITE_FARMER_PASSWORD / VITE_COORDINATOR_PASSWORD for anything but a local run.
 */
export const DEFAULT_FARMER_PASSWORD = 'farmer123';
export const DEFAULT_COORDINATOR_PASSWORD = 'coordinator123';

export function isRole(value: unknown): value is Role {
  return value === 'farmer' || value === 'coordinator';
}

/** The password configured for a role, falling back to the documented default. */
export function configuredPassword(role: Role): string {
  const env = import.meta.env;
  const configured = role === 'farmer' ? env.VITE_FARMER_PASSWORD : env.VITE_COORDINATOR_PASSWORD;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return role === 'farmer' ? DEFAULT_FARMER_PASSWORD : DEFAULT_COORDINATOR_PASSWORD;
}

export function passwordMatches(role: Role, password: string): boolean {
  return password.length > 0 && password === configuredPassword(role);
}

/** Parse a persisted session, rejecting anything that is not a real session. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!isRole(record.role) || typeof record.signedInAt !== 'string' || record.signedInAt.length === 0) return null;
    return { role: record.role, signedInAt: record.signedInAt };
  } catch {
    return null;
  }
}

export function serializeSession(session: Session): string {
  return JSON.stringify({ role: session.role, signedInAt: session.signedInAt });
}

export function readSession(): Session | null {
  try {
    return parseSession(window.localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  try {
    window.localStorage.setItem(SESSION_KEY, serializeSession(session));
  } catch {
    // Storage unavailable (private mode): the session stays in memory only.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}
