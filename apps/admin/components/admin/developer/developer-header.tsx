'use client';

import { HEADER_ACTIONS, HEADER_PRIMARY, HeaderIconButton } from '@/components/admin/header-buttons';
import type { LucideIcon } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeveloperStatus } from './use-developer-status';

/** The title row every Developer page opens with, and the status error under it. */
export function DeveloperHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  const status = useDeveloperStatus();
  return (
    <>
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className={HEADER_ACTIONS}>
          <HeaderIconButton label="Refresh" onClick={() => void status.refetch()} disabled={status.isFetching}>
            <RefreshCw className={status.isFetching ? 'animate-spin' : ''} />
          </HeaderIconButton>
        </div>
      </header>
      {status.error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error.message}
        </p>
      )}
    </>
  );
}
