import { createRoot } from 'react-dom/client';
import '../app/styles/global.css';
import './check.css';
import { CheckApp } from './CheckApp';

// No StrictMode: its double mount would open the camera twice.
const root = document.getElementById('root');
if (root) createRoot(root).render(<CheckApp />);
