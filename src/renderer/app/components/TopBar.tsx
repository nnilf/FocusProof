import { Link, NavLink } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Logo } from './Logo';

const link = ({ isActive }: { isActive: boolean }): string => `topbar-link ${isActive ? 'active' : ''}`;

export function TopBar() {
  return (
    <header className="topbar">
      <Link to="/" className="wordmark">
        <Logo />
        FocusProof
      </Link>
      <nav aria-label="Main">
        <NavLink to="/" end className={link}>
          Today
        </NavLink>
        <NavLink to="/progress" className={link}>
          Progress
        </NavLink>
      </nav>
      <NavLink to="/settings" className={({ isActive }) => `settings-link ${isActive ? 'active' : ''}`} aria-label="Settings" title="Settings">
        <Settings size={18} strokeWidth={1.75} />
      </NavLink>
    </header>
  );
}
