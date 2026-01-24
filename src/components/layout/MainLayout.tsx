import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';
import { ErrorBoundary, ToastContainer } from '../ui';
import { SkipLink } from '../ui/SkipLink';
import { ProfileSetup } from '../user';
import { useUserStore } from '../../store/userStore';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const isProfileComplete = useUserStore((state) => state.isProfileComplete());

  return (
    <div className="h-screen bg-[--color-dark] text-white grid grid-rows-[auto_1fr] overflow-hidden">
      <TitleBar />
      {!isProfileComplete ? (
        <ProfileSetup />
      ) : (
        <>
          <SkipLink />
          <main
            id="main-content"
            className="min-h-0 overflow-hidden"
            role="main"
          >
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </>
      )}
      <ToastContainer />
    </div>
  );
}
