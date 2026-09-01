'use client';

/**
 * The pieces both steps of the post-payment screen use.
 *
 * They live here rather than in either step because the alternative is a cycle:
 * `documents-screen.tsx` renders both steps, and both steps need to be able to
 * put an error in front of the customer. One shared leaf module, imported by
 * everything, imported by nothing.
 *
 * ── THE COPY RULE, WHICH APPLIES TO EVERY STRING ON THIS SURFACE ────────────
 * Nothing on the post-payment screen may say "confirmed" or "complete". Sending
 * documents is not approval: an operator reviews them afterwards and can still
 * reject the booking, and `notify-booking-approved` is the only email in the
 * product that carries the word "confirmed". What these screens say instead is:
 * received, under review, we will confirm shortly.
 */

import type { LucideIcon } from 'lucide-react';

import { Panel } from '@/components/portal/primitives';
import { CircleAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { BookingDocumentsSession } from '@/hooks/use-booking-documents';

/** Bytes as something a person reads. Sub-MB stays in KB; a phone photo is MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProblemBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-[14px] border border-danger-subtle/40 bg-danger-light px-4 py-3"
    >
      <CircleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="min-w-0 text-sm leading-relaxed text-brand-text">{message}</p>
    </div>
  );
}

const NOTICE_TONE = {
  success: { wrap: 'bg-success-light', icon: 'text-success' },
  warning: { wrap: 'bg-warning-light', icon: 'text-warning' },
  danger: { wrap: 'bg-danger-light', icon: 'text-danger' },
} as const;

export function NoticeScreen({
  icon: Icon,
  tone,
  title,
  body,
  action,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof NOTICE_TONE;
  title: string;
  body: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const palette = NOTICE_TONE[tone];
  return (
    <Panel className="px-5 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className={cn('grid size-11 place-items-center rounded-full', palette.wrap)}>
          <Icon aria-hidden strokeWidth={1.75} className={cn('size-5', palette.icon)} />
        </span>
        <h1 className="text-base font-medium text-brand-text">{title}</h1>
        <p className="max-w-md text-sm leading-relaxed text-brand-text-soft">{body}</p>
        {action ? <div className="mt-1">{action}</div> : null}
        {children}
      </div>
    </Panel>
  );
}

/**
 * The operator's name and mark, from what the LINK FUNCTION returned.
 *
 * NOT from `TenantContext`. This page is opened from an email that may land on
 * the apex host rather than the tenant's subdomain, so the context's tenant can
 * legitimately be the wrong one — or absent. The function resolved the tenant
 * from the rental itself, which is the only source that cannot be wrong here.
 */
export function BrandHeader({ session }: { session: BookingDocumentsSession | null }) {
  const name = session?.tenant.companyName ?? null;
  const logo = session?.tenant.logoUrl ?? null;

  if (!name && !logo) return null;

  return (
    <div className="mb-6 flex items-center gap-3">
      {logo ? (
        // A plain <img>, matching `auth-brand.tsx`. next/image is not configured
        // with a remote pattern for tenant logo hosts in this app.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-9 w-auto max-w-[160px] object-contain" />
      ) : null}
      {name ? <span className="text-sm font-medium text-brand-text">{name}</span> : null}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <Panel className="flex flex-col gap-3 px-4 py-5 sm:px-5">
      <Skeleton className="h-5 w-56 bg-brand-stone" />
      <Skeleton className="h-4 w-full bg-brand-stone" />
      <Skeleton className="h-4 w-2/3 bg-brand-stone" />
      <Skeleton className="mt-3 h-40 w-full rounded-[14px] bg-brand-stone" />
    </Panel>
  );
}
