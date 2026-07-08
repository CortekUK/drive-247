'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link2, Copy, Check, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/format-utils';
import type { PaymentLink, PaymentLinkStatus } from '@/hooks/use-payment-links';

interface PaymentLinksPanelProps {
  links: PaymentLink[];
  isLoading: boolean;
  currencyCode: string;
  title?: string;
  emptyText?: string;
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
};

// Human label for what a link was for, derived from its shape.
function describeLink(link: PaymentLink): string {
  if (link.extensionId) return 'Weekly renewal';
  const cats = link.targetCategories ?? [];
  if (cats.some((c) => c === 'Fine' || c === 'Fines')) return 'Fine / toll';
  if (cats.some((c) => c.startsWith('Extension'))) return 'Renewal';
  if (link.paymentType === 'InitialFee') return 'Deposit / initial';
  if (link.paymentType === 'Excess Mileage') return 'Excess mileage';
  if (cats.length > 0) return cats.join(', ');
  return 'Balance';
}

function StatusBadge({ status }: { status: PaymentLinkStatus }) {
  const meta = STATUS_META[status];
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

export function PaymentLinksPanel({
  links,
  isLoading,
  currencyCode,
  title = 'Payment Links',
  emptyText = 'No payment links have been sent yet.',
}: PaymentLinksPanelProps) {
  const counts = useMemo(() => {
    const c = { paid: 0, awaiting: 0, other: 0 };
    for (const l of links) {
      if (l.status === 'paid') c.paid += 1;
      else if (l.status === 'awaiting') c.awaiting += 1;
      else c.other += 1;
    }
    return c;
  }, [links]);

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
              {links.map((link) => (
                <TableRow key={link.id} className={link.status === 'superseded' ? 'opacity-60' : undefined}>
                  <TableCell className="text-sm py-2.5 whitespace-nowrap">
                    {format(new Date(link.createdAt), 'MMM d, yyyy · h:mm a')}
                  </TableCell>
                  <TableCell className="text-sm py-2.5">{describeLink(link)}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums py-2.5">
                    {formatCurrency(link.amount, currencyCode)}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <StatusBadge status={link.status} />
                    {link.status === 'paid' && link.paidAt && (
                      <span className="text-[11px] text-muted-foreground ml-2 hidden sm:inline">
                        {format(new Date(link.paidAt), 'MMM d')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 text-right">
                    {/* Copy is only possible where a reusable customer URL is stored
                        (extension links today). Awaiting/expired links elsewhere have
                        no persisted URL — a fresh link must be re-sent to reuse. */}
                    {link.checkoutUrl && (link.status === 'awaiting' || link.status === 'expired') ? (
                      <CopyLinkButton url={link.checkoutUrl} />
                    ) : null}
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
