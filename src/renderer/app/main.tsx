import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import './styles/global.css';
import { TopBar } from './components/TopBar';
import { RecoveryDialog } from './components/RecoveryDialog';
import { useLiveStore } from './stores/liveStore';
import { call, onEvent } from './lib/api';
import { TodayPage } from './pages/TodayPage';
import { ProgressPage } from './pages/ProgressPage';
import { AssignmentPage } from './pages/AssignmentPage';
import { ReportPage } from './pages/ReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { LiveSession } from './pages/LiveSession';
import { SetupPage } from './pages/SetupPage';

function App() {
  const init = useLiveStore((s) => s.init);
  const live = useLiveStore((s) => s.status !== null);
  const navigate = useNavigate();
  useEffect(() => init(), [init]);
  useEffect(() => onEvent('session:ended', ({ sessionId }) => navigate(`/report/${sessionId}`)), [navigate]);
  // First launch only: walk through setup once.
  useEffect(() => {
    void call('setup:status', {}).then(({ show }) => show && navigate('/setup', { replace: true }));
  }, [navigate]);

  // A running session takes over the window: nothing else to click into.
  if (live) {
    return (
      <div className="app" style={{ gridTemplateRows: '1fr' }}>
        <main className="main">
          <LiveSession />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/assignments/:id" element={<AssignmentPage />} />
          <Route path="/report/:id" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/history" element={<Navigate to="/progress" replace />} />
          <Route path="/analytics" element={<Navigate to="/progress" replace />} />
          <Route path="/privacy" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
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
