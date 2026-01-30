import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { TrysteroProvider } from './contexts/TrysteroContext';

// Expose stores globally for E2E testing and dual-instance testing
// Using static imports to ensure they're available immediately
import { useSessionStore } from './store/sessionStore';
import { useRecordingStore } from './store/recordingStore';
import { usePeerStore } from './store/peerStore';
import { useTransferStore } from './store/transferStore';
import { useUserStore } from './store/userStore';

// Expose on window for testing scripts to access
(window as Record<string, unknown>).useSessionStore = useSessionStore;
(window as Record<string, unknown>).useRecordingStore = useRecordingStore;
(window as Record<string, unknown>).usePeerStore = usePeerStore;
(window as Record<string, unknown>).useTransferStore = useTransferStore;
(window as Record<string, unknown>).useUserStore = useUserStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrysteroProvider>
      <App />
    </TrysteroProvider>
  </StrictMode>
);
