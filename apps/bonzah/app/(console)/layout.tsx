'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[110px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, checkAuth, logout } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/bonzah-logo.svg" alt="Bonzah" className="h-6 w-auto" />
              <span className="hidden sm:block h-5 w-px bg-border" />
              <span className="hidden sm:block text-[13px] font-medium text-muted-foreground">
                Partner Console
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground hidden sm:block">{user.email}</span>
              <button
                onClick={async () => {
                  await logout();
                  router.push('/login');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
