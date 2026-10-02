import { NavLink } from 'react-router-dom';
import { BarChart3, BookOpen, Camera, History, LayoutDashboard, Settings, Shield, Timer } from 'lucide-react';
import { useLiveStore } from '../stores/liveStore';
import { CLASS_LABEL, formatDuration } from '../lib/format';
import { Alt } from './ui';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assignments', label: 'Assignments', icon: BookOpen },
  { to: '/session', label: 'Session', icon: Timer },
  { to: '/history', label: 'History', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/privacy', label: 'Privacy', icon: Shield },
];

export function Sidebar() {
  const status = useLiveStore((s) => s.status);
  const now = useLiveStore((s) => s.now);
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        FocusProof
      </div>
      {LINKS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Icon size={16} strokeWidth={1.75} aria-hidden />
          {label}
        </NavLink>
      ))}
      <div className="nav-spacer" />
      {status && (
        <NavLink to="/session" className="nav-session">
          <span className="badge-live">
            <span className="pulse" aria-hidden /> Session running
          </span>
          <strong>{formatDuration(now - status.startedAt, { seconds: true })}</strong>
          <span>
            <Alt /> {formatDuration(status.altMs)} · {status.classification ? CLASS_LABEL[status.classification] : '…'}
          </span>
          {status.camera.state === 'active' && (
            <span className="camera-on">
              <Camera size={12} aria-hidden /> Camera active
            </span>
          )}
        </NavLink>
      )}
    </nav>
  );
}
