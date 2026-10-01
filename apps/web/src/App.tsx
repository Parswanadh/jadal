import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import { FarmerPortal } from './farmer';
import { CoordinatorConsole } from './coordinator';
import { CanalVisual } from './canal';
import { SimulatedPhone } from './phone';
import { DemoMode } from './demo';
import { RequireRole } from './auth';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        {/* Public screens. */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/canal" element={<CanalVisual />} />
        <Route path="/phone" element={<SimulatedPhone />} />
        <Route path="/demo" element={<DemoMode />} />

        {/* Role-gated portals. The splat keeps the query-param tabs working. */}
        <Route
          path="/farmer/*"
          element={
            <RequireRole role="farmer">
              <FarmerPortal />
            </RequireRole>
          }
        />
        <Route
          path="/coordinator/*"
          element={
            <RequireRole role="coordinator">
              <CoordinatorConsole />
            </RequireRole>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
