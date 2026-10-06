'use client';

/**
 * Developer — the tools that used to be the Northwind portal's `/dev` page,
 * plus the signup rehearsal.
 *
 * Super admins only: the nav hides it from everyone else, this page sends them
 * back to the dashboard, and the `dev-signup-rehearsal` edge function behind
 * every button refuses anyone who is not an active super admin.
 *
 *   Signup rehearsal      the real signup, repeatable with one email
 *   Northwind onboarding  first-time operator / quick tour / demo journey
 *   Previews              skeletons, messages, billing, empty states (localhost)
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, TerminalSquare } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { callDeveloper, type DeveloperStatus } from '@/components/admin/developer/developer-api';
import { RehearsalCard } from '@/components/admin/developer/rehearsal-card';
import { NorthwindCard } from '@/components/admin/developer/northwind-card';
import { PreviewsCard } from '@/components/admin/developer/previews-card';

export default function DeveloperPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [status, setStatus] = useState<DeveloperStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user && !user.is_super_admin) router.push('/admin/dashboard');
  }, [user, router]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const res = await callDeveloper({ action: 'get' });
    setRefreshing(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setStatus(res.body as unknown as DeveloperStatus);
  }, []);

  useEffect(() => {
    if (user?.is_super_admin) void load();
  }, [user, load]);

  if (user && !user.is_super_admin) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <TerminalSquare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Developer</h1>
          <p className="text-sm text-muted-foreground">
            Rehearse the real signup and drive the Northwind canary. Nothing here affects any other tenant.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw className={`mr-2 size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <RehearsalCard status={status} onChanged={load} />
      <NorthwindCard />
      <PreviewsCard initial={status?.settings.portalPreviews ?? null} />
    </div>
  );
}
