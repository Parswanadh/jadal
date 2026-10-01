import { useEffect, useState } from 'react';
import { CanalVisual } from './canal';

interface HealthResponse {
  ok: boolean;
  version: string;
  commit: string;
}

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function HealthCard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  return (
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
  );
}

export default function App() {
  const route = useHashRoute();
  const onCanal = route.startsWith('#/canal');

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem 1rem', maxWidth: '1000px', margin: '0 auto', lineHeight: 1.5 }}>
      <nav aria-label="Primary" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <a href="#/">Home</a>
        <a href="#/canal">Canal map · కాలువ పటం</a>
      </nav>
      {onCanal ? (
        <CanalVisual />
      ) : (
        <>
          <h1>Jadal</h1>
          <p>Warabandi-style Canal Irrigation Management &amp; Agentic AI</p>
          <p>
            <a href="#/canal">See the canal water map →</a>
          </p>
          <HealthCard />
        </>
      )}
    </main>
  );
}
