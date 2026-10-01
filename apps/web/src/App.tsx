import { useEffect, useState } from 'react';
import DemoMode from './demo/DemoMode';

interface HealthResponse {
  ok: boolean;
  version: string;
  commit: string;
}

function isDemoRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/demo') || window.location.hash.startsWith('#/demo');
}

export default function App() {
  const [route, setRoute] = useState<string>(isDemoRoute() ? 'demo' : 'home');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onNav = () => setRoute(isDemoRoute() ? 'demo' : 'home');
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);

  useEffect(() => {
    if (route !== 'home') return;
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        setHealth(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [route]);

  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    window.history.pushState(null, '', path);
    setRoute(path.startsWith('/demo') ? 'demo' : 'home');
  };

  if (route === 'demo') {
    return (
      <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.5 }}>
        <nav aria-label="Primary" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #d1d5db' }}>
          <a href="/" onClick={go('/')}>Home</a>
          {' · '}
          <a href="/demo" onClick={go('/demo')} aria-current="page">Demo mode</a>
        </nav>
        <DemoMode />
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', maxWidth: '640px', margin: '0 auto', lineHeight: 1.5 }}>
      <h1>Jadal</h1>
      <p>Warabandi-style Canal Irrigation Management &amp; Agentic AI</p>
      <nav aria-label="Primary">
        <a href="/demo" onClick={go('/demo')}>Open Demo mode (6-step walkthrough) / డెమో</a>
      </nav>

      <section style={{ border: '1px solid #d1d5db', borderRadius: '8px', padding: '1.25rem', marginTop: '1.5rem', background: '#f9fafb' }}>
        <h2 style={{ marginTop: 0 }}>System Health</h2>
        {loading && <p>Checking /api/health...</p>}
        {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}
        {health && (
          <div>
            <p><strong>Status:</strong> {health.ok ? 'Operational' : 'Degraded'}</p>
            <p><strong>Version:</strong> {health.version}</p>
            <p><strong>Commit:</strong> <code>{health.commit}</code></p>
          </div>
        )}
      </section>
    </main>
  );
}
