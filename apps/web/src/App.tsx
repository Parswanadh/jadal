import { useEffect, useState } from 'react';

interface HealthResponse {
  ok: boolean;
  version: string;
  commit: string;
}

export default function App() {
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
    <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', maxWidth: '640px', margin: '0 auto', lineHeight: 1.5 }}>
      <h1>Jadal</h1>
      <p>Warabandi-style Canal Irrigation Management &amp; Agentic AI</p>

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
