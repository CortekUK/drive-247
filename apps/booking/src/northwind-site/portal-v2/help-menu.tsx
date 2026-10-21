'use client';

/**
 * Help, as the operator's top bar has it (top-bar-v2.tsx): the helpline as a
 * `tel:` link, then a "Help" pill carrying the gradient sparkle mark, the two
 * ways to get help side by side. There is no Support tab — Help covers it
 * (owner, Oct 21 2026).
 *
 * The operator's Help opens Trax, the operator assistant. A customer's help
 * is the rental company itself, so this one opens a short menu of the ways to
 * reach them: a message (the top bar's Messages sheet), a call, an email, and
 * the site's contact page. The helpline is the COMPANY's number, not
 * Drive247's — the customer's help desk is their rental company.
 */

import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowUpRight, Mail, MessageCircle, Phone, Sparkles } from 'lucide-react-nw';

import { MOTION_ANCHORED } from '@nw/components/ui/motion';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { cn } from '@nw/lib/utils';

/** The operator's Help mark at `xs`: a 20px gradient badge with the sparkle. */
export function HelpMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative isolate inline-flex size-5 shrink-0 items-center justify-center rounded-full', className)}>
      <span className="absolute inset-0 overflow-hidden rounded-full shadow-[0_2px_6px_-2px_color-mix(in_srgb,var(--pv-primary)_50%,transparent)]">
        <span className="absolute -inset-1/4 bg-[conic-gradient(from_180deg,hsl(var(--v2-chart-2)),hsl(var(--v2-primary)),hsl(var(--v2-chart-4)),hsl(var(--v2-chart-1)),hsl(var(--v2-chart-2)))]" />
      </span>
      <Sparkles strokeWidth={2} className="relative size-3 text-pv-primary-fg drop-shadow-[0_1px_2px_hsl(var(--v2-chart-5)/0.55)]" />
    </span>
  );
}

const ITEM =
  'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-pv-fg outline-none ' +
  'transition-colors duration-200 data-[highlighted]:bg-pv-hover motion-reduce:transition-none';

/** "+1 (555) 010-0199" → "tel:+15550100199". */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export function HelplineLink({ className }: { className?: string }) {
  const { tenant } = useTenant();
  const phone = tenant?.contact_phone?.trim() || tenant?.phone?.trim() || null;
  const company = tenant?.company_name ?? tenant?.app_name ?? 'the rental company';
  if (!phone) return null;
  return (
    <a
      href={telHref(phone)}
      aria-label={`Call ${company} on ${phone}`}
      title={`Call ${company}`}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-pv-link transition-colors duration-200 hover:bg-pv-primary/10 motion-reduce:transition-none',
        className,
      )}
    >
      <Phone aria-hidden className="size-4 shrink-0" />
      <span className="hidden tabular-nums md:inline">{phone}</span>
    </a>
  );
}

export function HelpMenu({ onOpenMessages, tipClassName }: { onOpenMessages: () => void; tipClassName?: string }) {
  const { tenant } = useTenant();
  const { displayName } = useCustomer();
  const company = tenant?.company_name ?? tenant?.app_name ?? 'your rental company';
  const phone = tenant?.contact_phone?.trim() || tenant?.phone?.trim() || null;
  const email = tenant?.contact_email?.trim() || null;
  const firstName = displayName?.split(/\s+/)[0] ?? null;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Help"
          title={tipClassName ? undefined : 'How can we help?'}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full pl-1.5 pr-2.5 text-[13px] font-medium text-pv-link outline-none transition-colors duration-200 hover:bg-pv-primary/10 focus-visible:ring-2 focus-visible:ring-pv-ring/50 aria-expanded:bg-pv-primary/10 motion-reduce:transition-none"
        >
          <HelpMark />
          Help
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn('z-50 w-72 overflow-hidden rounded-xl border border-pv-border bg-pv-card p-0 text-pv-fg shadow-lg outline-none', MOTION_ANCHORED)}
        >
          <div className="flex items-center gap-2.5 p-3 pb-2.5">
            <HelpMark className="size-7 [&>svg]:size-3.5" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight">
                {firstName ? `Hi ${firstName}, how can we help?` : 'How can we help?'}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-pv-muted-fg">{company} is here for you.</p>
            </div>
          </div>
          <DropdownMenu.Separator className="h-px bg-pv-border" />
          <div className="p-1.5">
            <DropdownMenu.Item className={ITEM} onSelect={onOpenMessages}>
              <MessageCircle aria-hidden className="size-4 text-pv-muted-fg" />
              <span className="flex-1">Message {company}</span>
            </DropdownMenu.Item>
            {phone ? (
              <DropdownMenu.Item asChild className={ITEM}>
                <a href={telHref(phone)}>
                  <Phone aria-hidden className="size-4 text-pv-muted-fg" />
                  <span className="flex-1">Call</span>
                  <span className="text-[12px] tabular-nums text-pv-muted-fg">{phone}</span>
                </a>
              </DropdownMenu.Item>
            ) : null}
            {email ? (
              <DropdownMenu.Item asChild className={ITEM}>
                <a href={`mailto:${email}`}>
                  <Mail aria-hidden className="size-4 text-pv-muted-fg" />
                  <span className="flex-1">Email</span>
                  <span className="max-w-[9rem] truncate text-[12px] text-pv-muted-fg">{email}</span>
                </a>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item asChild className={ITEM}>
              <Link href="/contact">
                <ArrowUpRight aria-hidden className="size-4 text-pv-muted-fg" />
                <span className="flex-1">Contact page</span>
              </Link>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
