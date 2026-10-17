'use client';

import Link from 'next/link';
import { ArrowUpRight, Wrench } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { DEVELOPER_ROOT } from '@/components/admin/admin-nav';

/**
 * The way into the Developer pages, pinned to the bottom of the rail beside
 * the profile row — the same block as Northwind's portal sidebar
 * (apps/portal/src/components/shared/layout/dev-section.tsx), class for class.
 *
 * Dashed border, monospace, no brand colour: it borrows the v2 tokens so it
 * does not look broken next to the avatar, while looking like nothing else in
 * the product does. Super admins only, as the Developer layout itself is.
 */
export function DevSection({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuthStore();
  if (!user?.is_super_admin) return null;

  return (
    <Link
      href={DEVELOPER_ROOT}
      onClick={onNavigate}
      className="mb-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      data-testid="dev-section"
      title="Developer tools for the Northwind canary"
    >
      <Wrench className="h-3 w-3 shrink-0" />
      <span className="flex-1 text-left">Developer</span>
      <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />
    </Link>
  );
}
