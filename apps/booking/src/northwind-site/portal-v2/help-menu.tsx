'use client';

/**
 * Help, as the operator's top bar has it (top-bar-v2.tsx): the helpline as a
 * `tel:` link, then a "Help" pill carrying the gradient sparkle mark. Help
 * opens Trax, as the operator's does — the customer's Trax, which knows their
 * own account (trax/, customer-trax). There is no Support tab (owner, Oct 21
 * 2026). The helpline is the COMPANY's number, not Drive247's.
 */

import { Phone, Sparkles } from 'lucide-react-nw';

import { useTenant } from '@nw/contexts/TenantContext';
import { cn } from '@nw/lib/utils';

import { useCustomerTrax } from './trax/trax-context';

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

export function HelpButton() {
  const { open, toggle } = useCustomerTrax();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Help"
      aria-expanded={open}
      title="Hi, I'm Trax. How can I help? (⌘J)"
      className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full pl-1.5 pr-2.5 text-[13px] font-medium text-pv-link outline-none transition-colors duration-200 hover:bg-pv-primary/10 focus-visible:ring-2 focus-visible:ring-pv-ring/50 aria-expanded:bg-pv-primary/10 motion-reduce:transition-none"
    >
      <HelpMark />
      Help
    </button>
  );
}
