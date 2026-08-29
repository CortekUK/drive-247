'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link2, Copy, Check, ExternalLink, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatCurrency } from '@/lib/format-utils';
import { toast } from '@/hooks/use-toast';
import { useVoidPaymentLink } from '@/hooks/use-void-payment-link';
import type { PaymentLink, PaymentLinkStatus } from '@/hooks/use-payment-links';

interface PaymentLinksPanelProps {
  links: PaymentLink[];
  isLoading: boolean;
  currencyCode: string;
  title?: string;
  emptyText?: string;
  /** When true, staff can void unpaid links (gated by edit permission at the call site). */
  allowVoid?: boolean;
  /**
   * Per-category allocation ledger for the rental this panel belongs to
   * (useRentalPaymentBreakdown). Optional: without it every link is reported
   * from its own row alone, exactly as before.
   */
  categoryLedger?: Record<string, { total: number; paid: number; remaining: number }>;
  /** Per-category refunded totals (useRentalRefundBreakdown). */
  categoryRefunds?: Record<string, number>;
}

const STATUS_META: Record<
  PaymentLinkStatus,
  { label: string; className: string }
> = {
  paid: {
    label: 'Paid',
    className:
      'text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:bg-emerald-950/30',
  },
  awaiting: {
    label: 'Awaiting payment',
    className:
      'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30',
  },
  expired: {
    label: 'Expired',
    className:
      'text-muted-foreground border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
  },
  superseded: {
    label: 'Superseded',
    className:
      'text-muted-foreground border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
  },
  deposit_hold: {
    label: 'Deposit hold',
    className:
      'text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-300 dark:border-blue-700 dark:bg-blue-950/30',
  },
  voided: {
    label: 'Voided',
    className:
      'text-muted-foreground border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
  },
  // Staff Accept/Reject decision (mirrors the Payments tab), so a declined or approved
  // payment no longer masquerades as an open 'Awaiting' link here.
  rejected: {
    label: 'Rejected',
    className:
      'text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-700 dark:bg-red-950/30',
  },
  approved: {
    label: 'Approved',
    className:
      'text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:bg-emerald-950/30',
  },
};

// A link row carries only its OWN payment state, and that is not the whole truth
// about the debt it was sent for. The same charge can be settled by a different
// payment entirely — cash recorded at the desk, a card taken in person, an
// earlier link — and the request row is then left Pending forever, still
// advertising "Awaiting payment" for money that has already arrived. Worse, once
// that settled charge is refunded the panel is two states behind the Payment
// Breakdown sitting directly beneath it.
//
// So when the caller hands us the rental's allocation ledger, a link whose
// TARGET CATEGORIES are fully settled is reported from the ledger instead: Paid,
// or Refunded / Partial refund once money has gone back. Derived from the
// amounts, so it holds for any category and any refund size.
type DisplayStatus = PaymentLinkStatus | 'refunded' | 'partial_refund';

const DERIVED_STATUS_META: Record<'refunded' | 'partial_refund', { label: string; className: string }> = {
  refunded: {
    label: 'Refunded',
    className:
      'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30',
  },
  partial_refund: {
    label: 'Partial refund',
    className:
      'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30',
  },
};

/** Only a link that still needs paying can be re-read from the ledger. */
const OPEN_STATUSES: PaymentLinkStatus[] = ['awaiting', 'expired', 'superseded'];

export function resolveDisplayStatus(
  link: PaymentLink,
  categoryLedger?: Record<string, { total: number; paid: number; remaining: number }>,
  categoryRefunds?: Record<string, number>,
): DisplayStatus {
  if (!categoryLedger || !OPEN_STATUSES.includes(link.status)) return link.status;

  // Without target categories there is nothing to look up. A general "Balance"
  // request is deliberately left alone: it is not tied to any one charge, so a
  // settled ledger is no evidence that THIS request is what settled it.
  const categories = link.targetCategories ?? [];
  if (categories.length === 0) return link.status;

  let paid = 0;
  let refunded = 0;
  for (const category of categories) {
    const led = categoryLedger[category];
    // Unknown or still-owed category — the request is live. One is enough.
    if (!led || led.total <= 0 || led.paid <= 0 || led.remaining > 0.01) return link.status;
    paid += led.paid;
    refunded += categoryRefunds?.[category] ?? 0;
  }

  if (refunded > 0) {
    return refunded >= paid - 0.01 ? 'refunded' : 'partial_refund';
  }
  return 'paid';
}

// An unpaid link that staff may safely remove: awaiting/expired/superseded. Never
// Paid, never a Deposit hold, never an already-Voided row.
const VOIDABLE_STATUSES: DisplayStatus[] = ['awaiting', 'expired', 'superseded'];

// Human label for what a link was for, derived from its shape.
export function describeLink(link: PaymentLink): string {
  if (link.extensionId) return 'Weekly renewal';
  const cats = link.targetCategories ?? [];
  if (cats.some((c) => c === 'Fine' || c === 'Fines')) return 'Fine / toll';
  if (cats.some((c) => c.startsWith('Extension'))) return 'Renewal';
  if (link.paymentType === 'InitialFee') return 'Deposit / initial';
  if (link.paymentType === 'Excess Mileage') return 'Excess mileage';
  if (cats.length > 0) return cats.join(', ');
  return 'Balance';
}

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const meta =
    status === 'refunded' || status === 'partial_refund'
      ? DERIVED_STATUS_META[status]
      : STATUS_META[status];
  return (
    <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
      {meta.label}
    </Badge>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      title="Copy payment link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function VoidLinkButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const { mutate, isPending } = useVoidPaymentLink();

  const handleVoid = () => {
    mutate(
      { paymentId, reason: 'Duplicate/stale link removed by staff' },
      {
        onSuccess: () => {
          toast({
            title: 'Payment link voided',
            description: 'The duplicate link was removed. The rental is unaffected.',
          });
          setOpen(false);
        },
        onError: (e: unknown) => {
          toast({
            title: 'Could not void link',
            description: (e as { message?: string })?.message ?? 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-red-600"
          title="Void this payment link"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this payment link?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes only this one unpaid link. The rental, the vehicle, and any
            payments the guest has already made are not affected. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleVoid();
            }}
            disabled={isPending}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            {isPending ? 'Voiding…' : 'Void link'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PaymentLinksPanel({
  links,
  isLoading,
  currencyCode,
  title = 'Payment Links',
  emptyText = 'No payment links have been sent yet.',
  allowVoid = false,
  categoryLedger,
  categoryRefunds,
}: PaymentLinksPanelProps) {
  // Resolved once, reused by the header counts and the rows, so the summary line
  // and the badges under it can never disagree.
  const rows = useMemo(
    () =>
      links.map((link) => ({
        link,
        displayStatus: resolveDisplayStatus(link, categoryLedger, categoryRefunds),
      })),
    [links, categoryLedger, categoryRefunds],
  );

  const counts = useMemo(() => {
    const c = { paid: 0, awaiting: 0, other: 0 };
    for (const { displayStatus } of rows) {
      if (displayStatus === 'paid') c.paid += 1;
      else if (displayStatus === 'awaiting') c.awaiting += 1;
      else c.other += 1;
    }
    return c;
  }, [rows]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            {title}
          </CardTitle>
          {links.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {counts.awaiting > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {counts.awaiting} awaiting
                </span>
              )}
              <span>
                {counts.paid} paid · {links.length} total
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-6 py-6 text-sm text-muted-foreground">Loading payment links…</div>
        ) : links.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground text-center">{emptyText}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                <TableHead>Sent</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ link, displayStatus }) => (
                <TableRow key={link.id} className={displayStatus === 'superseded' ? 'opacity-60' : undefined}>
                  <TableCell className="text-sm py-2.5 whitespace-nowrap">
                    {format(new Date(link.createdAt), 'MMM d, yyyy · h:mm a')}
                  </TableCell>
                  <TableCell className="text-sm py-2.5">{describeLink(link)}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums py-2.5">
                    {formatCurrency(link.amount, currencyCode)}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <StatusBadge status={displayStatus} />
                    {displayStatus === 'paid' && link.paidAt && (
                      <span className="text-[11px] text-muted-foreground ml-2 hidden sm:inline">
                        {format(new Date(link.paidAt), 'MMM d')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Copy is only possible where a reusable customer URL is stored
                          (extension links today). Awaiting/expired links elsewhere have
                          no persisted URL — a fresh link must be re-sent to reuse. */}
                      {link.checkoutUrl && (displayStatus === 'awaiting' || displayStatus === 'expired') ? (
                        <CopyLinkButton url={link.checkoutUrl} />
                      ) : null}
                      {allowVoid && VOIDABLE_STATUSES.includes(displayStatus) ? (
                        <VoidLinkButton paymentId={link.id} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
