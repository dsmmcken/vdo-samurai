import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { TrysteroProvider } from './contexts/TrysteroContext';

// Expose stores for E2E testing (only when media is mocked, indicating test mode)
if ((window as Record<string, unknown>).__MEDIA_MOCKED__) {
  import('./store/sessionStore').then((m) => {
    (window as Record<string, unknown>).useSessionStore = m.useSessionStore;
  });
  import('./store/recordingStore').then((m) => {
    (window as Record<string, unknown>).useRecordingStore = m.useRecordingStore;
  });
  import('./store/peerStore').then((m) => {
    (window as Record<string, unknown>).usePeerStore = m.usePeerStore;
  });
  import('./store/transferStore').then((m) => {
    (window as Record<string, unknown>).useTransferStore = m.useTransferStore;
  });
  import('./store/userStore').then((m) => {
    (window as Record<string, unknown>).useUserStore = m.useUserStore;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrysteroProvider>
      <App />
    </TrysteroProvider>
  </StrictMode>
);
