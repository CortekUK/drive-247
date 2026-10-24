'use client';

import { HEADER_ACTIONS, HEADER_PRIMARY, HeaderIconButton, PAGE_HEADER, PAGE_HEADER_TEXT, PAGE_TITLE, PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import type { LucideIcon } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeveloperStatus } from './use-developer-status';
import { cn } from '@/lib/utils';

/** The title row every Developer page opens with, and the status error under it. */
export function DeveloperHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  const status = useDeveloperStatus();
  return (
    <>
      <header className={cn('flex items-center gap-3', PAGE_HEADER)}>
        <div className={cn('min-w-0 flex-1', PAGE_HEADER_TEXT)}>
          <h1 className={cn('text-2xl font-bold tracking-tight sm:text-3xl', PAGE_TITLE)}>{title}</h1>
          <p className={cn('text-sm text-muted-foreground', PAGE_DESCRIPTION)}>{description}</p>
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
