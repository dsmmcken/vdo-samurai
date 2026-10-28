import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// The entrance animation plays once, on first load; later screen changes use
// view transitions instead.
document.documentElement.classList.add('boot');
setTimeout(() => document.documentElement.classList.remove('boot'), 900);

createRoot(document.getElementById('root')!).render(<App />);
