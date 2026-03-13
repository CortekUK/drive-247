'use client';

import Link from 'next/link';
import { Car, User, Calendar, Clock, XCircle, ArrowRightLeft, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';
import type { RentalRequestsData, RentalRequestItem } from '@/types/chat';

interface ChatRentalCardsProps {
  data: RentalRequestsData;
  onNavigate?: () => void;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const isActive = lower === 'active';
  const isPending = lower === 'pending';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
        isActive && 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
        isPending && 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
        !isActive && !isPending && 'bg-muted text-muted-foreground border border-border/40',
      )}
    >
      {status}
    </span>
  );
}

function ViewRentalLink({ rentalId, onNavigate }: { rentalId: string; onNavigate?: () => void }) {
  return (
    <Link
      href={`/rentals/${rentalId}`}
      onClick={onNavigate}
      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/60 bg-background/60 hover:bg-background transition-colors"
    >
      View Rental
      <ArrowUpRight className="h-3 w-3" />
    </Link>
  );
}

function ExtensionCard({ item, accentColor, onNavigate }: { item: RentalRequestItem; accentColor: string; onNavigate?: () => void }) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-500/10">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10">
            <ArrowRightLeft className="h-3 w-3 text-amber-500" />
          </div>
          <span className="text-[13px] font-semibold text-foreground">{item.rental_number}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          {item.rental_id && <ViewRentalLink rentalId={item.rental_id} onNavigate={onNavigate} />}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        {/* Customer & Vehicle */}
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground truncate">{item.customer_name}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground truncate">{item.vehicle}</span>
          </div>
        </div>

        {/* Date change visual */}
        <div className="flex items-center gap-2 rounded-lg bg-background/60 border border-border/30 px-3 py-2">
          <div className="flex-1 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Current end</div>
            <div className="text-[13px] font-medium text-foreground">
              {item.current_end_date ? formatDate(item.current_end_date) : '—'}
            </div>
          </div>
          <div className="flex h-6 w-6 items-center justify-center">
            <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="flex-1 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Requested</div>
            <div className="text-[13px] font-medium" style={{ color: accentColor }}>
              {item.requested_end_date ? formatDate(item.requested_end_date) : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CancellationCard({ item, onNavigate }: { item: RentalRequestItem; onNavigate?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-red-500/10">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10">
            <XCircle className="h-3 w-3 text-red-500" />
          </div>
          <span className="text-[13px] font-semibold text-foreground">{item.rental_number}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          {item.rental_id && <ViewRentalLink rentalId={item.rental_id} onNavigate={onNavigate} />}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        {/* Customer & Vehicle */}
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground truncate">{item.customer_name}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground truncate">{item.vehicle}</span>
          </div>
        </div>

        {/* Dates row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[12px] text-muted-foreground">
              {item.start_date ? formatDate(item.start_date) : '—'} — {item.end_date ? formatDate(item.end_date) : '—'}
            </span>
          </div>
        </div>

        {/* Reason */}
        {item.cancellation_reason && (
          <div className="flex items-start gap-1.5 rounded-lg bg-red-500/[0.04] border border-red-500/10 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <span className="text-[12px] text-red-400/90 leading-relaxed">
              &ldquo;{item.cancellation_reason}&rdquo;
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatRentalCards({ data, onNavigate }: ChatRentalCardsProps) {
  const { branding } = useTenantBranding();
  const accentColor = branding?.accent_color || '#6366f1';

  const hasExtensions = data.extensions && data.extensions.length > 0;
  const hasCancellations = data.cancellations && data.cancellations.length > 0;

  return (
    <div className="w-full space-y-3 animate-fade-in">
      {/* Extensions section */}
      {hasExtensions && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/10">
              <Clock className="h-3 w-3 text-amber-500" />
            </div>
            <span className="text-[13px] font-medium text-foreground">
              Extension Requests
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              ({data.extensions!.length})
            </span>
          </div>
          <div className="space-y-2">
            {data.extensions!.map((item) => (
              <ExtensionCard key={item.rental_id || item.rental_number} item={item} accentColor={accentColor} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}

      {/* Cancellations section */}
      {hasCancellations && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-red-500/10">
              <XCircle className="h-3 w-3 text-red-500" />
            </div>
            <span className="text-[13px] font-medium text-foreground">
              Cancellation Requests
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              ({data.cancellations!.length})
            </span>
          </div>
          <div className="space-y-2">
            {data.cancellations!.map((item) => (
              <CancellationCard key={item.rental_id || item.rental_number} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
