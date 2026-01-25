import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { TrysteroProvider } from './contexts/TrysteroContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrysteroProvider>
      <App />
    </TrysteroProvider>
  </StrictMode>
);
