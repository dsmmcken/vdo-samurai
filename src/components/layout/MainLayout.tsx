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
    <div className="min-h-screen bg-[--color-dark] text-white flex flex-col">
      <TitleBar />
      {!isProfileComplete ? (
        <ProfileSetup />
      ) : (
        <>
          <SkipLink />
          <main
            id="main-content"
            className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-4"
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
