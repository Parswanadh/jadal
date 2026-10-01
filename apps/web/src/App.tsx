import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import { FarmerPortal } from './farmer';
import { CoordinatorConsole } from './coordinator';
import { CanalVisual } from './canal';
import { SimulatedPhone } from './phone';
import { DemoMode } from './demo';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/farmer" element={<FarmerPortal />} />
        <Route path="/coordinator" element={<CoordinatorConsole />} />
        <Route path="/canal" element={<CanalVisual />} />
        <Route path="/phone" element={<SimulatedPhone />} />
        <Route path="/demo" element={<DemoMode />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
