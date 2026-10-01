import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import PlaceholderPage from './pages/PlaceholderPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/farmer"
          element={<PlaceholderPage titleKey="farmer.title" bodyKey="farmer.body" noteKey="farmer.note" />}
        />
        <Route
          path="/coordinator"
          element={<PlaceholderPage titleKey="coordinator.title" bodyKey="coordinator.body" noteKey="coordinator.note" />}
        />
        <Route
          path="/canal"
          element={<PlaceholderPage titleKey="canal.title" bodyKey="canal.body" noteKey="canal.note" />}
        />
        <Route
          path="/phone"
          element={<PlaceholderPage titleKey="phone.title" bodyKey="phone.body" noteKey="phone.note" />}
        />
        <Route
          path="/demo"
          element={<PlaceholderPage titleKey="demo.title" bodyKey="demo.body" noteKey="demo.note" />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
