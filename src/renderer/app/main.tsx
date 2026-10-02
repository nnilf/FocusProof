import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import './styles/global.css';
import { Sidebar } from './components/Sidebar';
import { RecoveryDialog } from './components/RecoveryDialog';
import { useLiveStore } from './stores/liveStore';
import { onEvent } from './lib/api';
import { DashboardPage } from './pages/DashboardPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { SessionPage } from './pages/SessionPage';
import { ReportPage } from './pages/ReportPage';
import { HistoryPage } from './pages/HistoryPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PrivacyPage } from './pages/PrivacyPage';

function App() {
  const init = useLiveStore((s) => s.init);
  const navigate = useNavigate();
  useEffect(() => init(), [init]);
  useEffect(() => onEvent('session:ended', ({ sessionId }) => navigate(`/report/${sessionId}`)), [navigate]);

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/assignments/:id" element={<AssignmentsPage />} />
          <Route path="/session" element={<SessionPage />} />
          <Route path="/report/:id" element={<ReportPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Routes>
      </main>
      <RecoveryDialog />
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
}
