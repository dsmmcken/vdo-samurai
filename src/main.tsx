import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// The entrance animation plays once, on first load; later screen changes use
// view transitions instead.
document.documentElement.classList.add('boot');
setTimeout(() => document.documentElement.classList.remove('boot'), 900);

// While the window is being resized, layout that's sized in units of the stage
// (the camera overlay) should follow instantly instead of animating.
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  document.documentElement.classList.add('resizing');
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => document.documentElement.classList.remove('resizing'), 200);
});

createRoot(document.getElementById('root')!).render(<App />);
