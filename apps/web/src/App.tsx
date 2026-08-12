import { Routes, Route } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import DocumentPage from './pages/DocumentPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/documents/:id" element={<DocumentPage />} />
    </Routes>
  );
}
