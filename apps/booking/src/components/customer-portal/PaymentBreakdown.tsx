'use client';

import { useMemo, useState } from 'react';
import {
  Car,
  Percent,
  ShieldCheck,
  Receipt,
  Shield,
  Truck,
  MapPin,
  Package,
  CalendarPlus,
  DollarSign,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { useRentalCharges, type RentalCharge } from '@/hooks/use-rental-ledger-data';
import { useRentalInvoice, useRentalPaymentBreakdown } from '@/hooks/use-rental-invoice';
import { useRentalInsurancePolicies } from '@/hooks/use-rental-insurance-policies';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface Rental {
  id: string;
  customer_id?: string;
  rental_period_type?: string | null;
  delivery_fee?: number | null;
  collection_fee?: number | null;
  deposit_hold_amount?: number | null;
  deposit_hold_status?: string | null;
  status?: string | null;
  approval_status?: string | null;
}

interface PaymentBreakdownProps {
  rental: Rental;
  customerEmail?: string | null;
}

interface Row {
  label: string;
  category: string;
  amount: number;
  detail: string;
  icon: any;
  color: string;
  bg: string;
}

const EXT_CATEGORIES = [
  'Extension',
  'Extension Rental',
  'Extension Tax',
  'Extension Service Fee',
  'Extension Insurance',
];

export default function PaymentBreakdown({ rental, customerEmail }: PaymentBreakdownProps) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';

  const { data: invoice } = useRentalInvoice(rental.id);
  const { data: rentalCharges } = useRentalCharges(rental.id);
  const { data: paymentBreakdown } = useRentalPaymentBreakdown(rental.id);
  const { data: insurancePolicies } = useRentalInsurancePolicies(rental.id);

  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedOriginal, setSelectedOriginal] = useState<Set<string>>(new Set());
  // Map of extension number → selected categories
  const [selectedExt, setSelectedExt] = useState<Record<number, Set<string>>>({});

  // categoryRemainingAmounts — from ledger
  const categoryRemainingAmounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (paymentBreakdown) {
      Object.entries(paymentBreakdown).forEach(([cat, t]) => {
        out[cat] = t.remaining;
      });
    }
    return out;
  }, [paymentBreakdown]);

  // Group extension charges by extension number
  const extensionGroups = useMemo(() => {
    const allExt = (rentalCharges || []).filter((c) => EXT_CATEGORIES.includes(c.category));
    const groups: Record<number, RentalCharge[]> = {};
    let nextLegacy = 1;
    allExt.forEach((charge) => {
      const m = charge.reference?.match(/Extension #(\d+)/);
      const n = m ? parseInt(m[1], 10) : nextLegacy++;
      if (!groups[n]) groups[n] = [];
      groups[n].push(charge);
    });
    const extPolicies = (insurancePolicies || [])
      .filter((p: any) => p.policy_type === 'extension')
      .sort(
        (a: any, b: any) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    return Object.entries(groups)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([num, charges], idx) => ({
        extensionNumber: parseInt(num),
        charges,
        totalAmount: charges.reduce((s, c) => s + c.amount, 0),
        totalRemaining: charges.reduce((s, c) => s + c.remaining_amount, 0),
        rentalCharge: charges.find(
          (c) => c.category === 'Extension Rental' || c.category === 'Extension'
        ),
        insurancePolicy: extPolicies[idx] || null,
      }));
  }, [rentalCharges, insurancePolicies]);

  const originalBonzah = (insurancePolicies || []).find(
    (p: any) => p.policy_type !== 'extension'
  );

  // Invoke checkout for a set of categories and a total
  const payCategories = async (totalAmount: number, targetCategories: string[]) => {
    if (!tenant?.id || totalAmount <= 0) return;
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rental.id,
          totalAmount,
          tenantId: tenant.id,
          customerEmail,
          source: 'booking',
          targetCategories,
          successUrl: `${window.location.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rental.id}&type=invoice`,
          cancelUrl: `${window.location.origin}/portal/bookings/${rental.id}`,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error('Failed to create payment link');
      }
    } catch (e) {
      toast.error('Failed to create payment link');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!invoice) return null;

  const isCancelledOrRejected =
    rental.status === 'Cancelled' || rental.approval_status === 'rejected';

  // Build original rows
  const insuranceCharge = (rentalCharges || []).find((c) => c.category === 'Insurance');
  const insuranceAmount = insuranceCharge?.amount ?? invoice.insurancePremium ?? 0;
  const deliveryFeeAmount = rental.delivery_fee || invoice.deliveryFee || 0;
  const collectionFeeAmount =
    (rentalCharges || []).find((c) => c.category === 'Collection Fee')?.amount ??
    rental.collection_fee ??
    0;

  const originalRows: Row[] = [
    {
      label: 'Rental',
      category: 'Rental',
      amount: invoice.rentalFee,
      detail: rental.rental_period_type || 'Monthly',
      icon: Car,
      color: 'text-green-500',
      bg: 'bg-green-500/10',
    },
    {
      label: 'Tax',
      category: 'Tax',
      amount: invoice.taxAmount,
      detail:
        invoice.taxAmount > 0 && invoice.rentalFee > 0
          ? `${((invoice.taxAmount / invoice.rentalFee) * 100).toFixed(1)}% rate`
          : 'Tax on rental',
      icon: Percent,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      label: originalBonzah ? 'Bonzah Insurance' : 'Insurance',
      category: 'Insurance',
      amount: insuranceAmount,
      detail: originalBonzah ? 'Bonzah Insurance' : 'Insurance coverage',
      icon: ShieldCheck,
      color: 'text-teal-500',
      bg: 'bg-teal-500/10',
    },
    {
      label: 'Service Fee',
      category: 'Service Fee',
      amount: invoice.serviceFee,
      detail: 'Platform fee',
      icon: Receipt,
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
    {
      label: 'Security Deposit',
      category: 'Security Deposit',
      amount: rental.deposit_hold_amount || invoice.securityDeposit,
      detail:
        rental.deposit_hold_status === 'held'
          ? 'On hold'
          : rental.deposit_hold_status === 'captured'
            ? 'Charged'
            : rental.deposit_hold_status === 'released'
              ? 'Released'
              : 'Refundable deposit',
      icon: Shield,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Delivery Fee',
      category: 'Delivery Fee',
      amount: deliveryFeeAmount,
      detail: 'Vehicle delivery',
      icon: Truck,
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
    },
    {
      label: 'Collection Fee',
      category: 'Collection Fee',
      amount: collectionFeeAmount,
      detail: 'Vehicle collection',
      icon: MapPin,
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
    },
    {
      label: 'Extras',
      category: 'Extras',
      amount: invoice.extrasTotal,
      detail: 'Add-ons',
      icon: Package,
      color: 'text-indigo-500',
      bg: 'bg-indigo-500/10',
    },
  ];

  // Excess mileage
  const excessMileage = (rentalCharges || []).find((c) => c.category === 'Excess Mileage');
  if (excessMileage) {
    originalRows.push({
      label: 'Excess Mileage',
      category: 'Excess Mileage',
      amount: excessMileage.amount,
      detail: excessMileage.reference || 'Over mileage allowance',
      icon: Receipt,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    });
  }

  const renderTable = (
    rows: Row[],
    selected: Set<string>,
    setSelected: (s: Set<string>) => void
  ) => {
    const selectable = rows
      .filter((r) => r.amount > 0 && (categoryRemainingAmounts[r.category] ?? 0) > 0)
      .map((r) => r.category);

    const allSelected =
      selectable.length > 0 && selectable.every((c) => selected.has(c));
    const someSelected = selectable.some((c) => selected.has(c));

    const selectedTotal =
      Math.round(
        selectable
          .filter((c) => selected.has(c))
          .reduce((sum, c) => sum + (categoryRemainingAmounts[c] ?? 0), 0) * 100
      ) / 100;

    const toggle = (category: string) => {
      const next = new Set(selected);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      setSelected(next);
    };

    const toggleAll = () => {
      if (allSelected) setSelected(new Set());
      else setSelected(new Set(selectable));
    };

    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              {selectable.length > 0 && (
                <TableHead className="pl-6 w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all unpaid"
                  />
                </TableHead>
              )}
              <TableHead className={selectable.length > 0 ? '' : 'pl-6'}>Category</TableHead>
              <TableHead className="text-center w-[110px]">Status</TableHead>
              <TableHead className="text-right w-[110px]">Amount</TableHead>
              <TableHead className="text-right pr-6 w-[120px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ label, category, amount, detail, icon: Icon, color, bg }) => {
              const applied = amount > 0;
              const remaining = categoryRemainingAmounts[category] ?? 0;
              const isPaid = applied && remaining === 0;
              const isPartial = applied && remaining > 0 && remaining < amount;
              const hasUnpaid = applied && !isPaid;
              const isSelectable = selectable.includes(category);
              const isSelected = selected.has(category);

              return (
                <TableRow key={category} className={!applied ? 'opacity-40' : ''}>
                  {selectable.length > 0 && (
                    <TableCell className="pl-6 w-10">
                      {isSelectable ? (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggle(category)}
                          aria-label={`Select ${label}`}
                        />
                      ) : null}
                    </TableCell>
                  )}
                  <TableCell className={selectable.length > 0 ? '' : 'pl-6'}>
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center ${applied ? bg : 'bg-muted/30'}`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 ${applied ? color : 'text-muted-foreground/50'}`}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">
                          {applied ? detail : 'Not applied'}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {!applied ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground/60 border-muted-foreground/20 text-[11px]"
                      >
                        Not Applied
                      </Badge>
                    ) : isPaid ? (
                      <Badge
                        variant="outline"
                        className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[11px]"
                      >
                        Paid
                      </Badge>
                    ) : isPartial ? (
                      <Badge
                        variant="outline"
                        className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]"
                      >
                        Partially Paid
                      </Badge>
                    ) : isCancelledOrRejected ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground border-muted-foreground/30 text-[11px]"
                      >
                        Cancelled
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-red-500 border-red-500/30 bg-red-500/10 text-[11px]"
                      >
                        Not Paid
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`text-sm font-semibold ${!applied ? 'text-muted-foreground/50' : ''}`}
                    >
                      {formatCurrency(amount, currencyCode)}
                    </span>
                    {isPartial && (
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(remaining, currencyCode)} remaining
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    {hasUnpaid && !isCancelledOrRejected ? (
                      <button
                        className="text-xs font-medium text-blue-500 hover:text-blue-400 hover:underline disabled:opacity-50"
                        disabled={isProcessing}
                        onClick={() => payCategories(remaining, [category])}
                      >
                        Pay
                      </button>
                    ) : (
                      <span className="text-muted-foreground/30">-</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {selected.size > 0 && (
          <div className="sticky bottom-0 border-t bg-primary/10 border-primary/30 px-6 py-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {selected.size} item{selected.size > 1 ? 's' : ''} selected &mdash;{' '}
              <span className="font-semibold text-foreground">
                {formatCurrency(selectedTotal, currencyCode)}
              </span>
            </p>
            <Button
              size="sm"
              disabled={isProcessing}
              onClick={() =>
                payCategories(selectedTotal, Array.from(selected).filter((c) => selectable.includes(c)))
              }
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <DollarSign className="h-3.5 w-3.5 mr-1.5" />
              )}
              Pay Selected
            </Button>
          </div>
        )}
      </>
    );
  };

  // Build extension row set for a group
  const renderExtensionTable = (group: (typeof extensionGroups)[number]) => {
    const refCharge = group.rentalCharge;
    const dateMatch = refCharge?.reference?.match(/\((.+?) → (.+?)\)/);
    const fromDate = dateMatch?.[1] || '';
    const toDate = dateMatch?.[2] || '';
    const daysMatch = refCharge?.reference?.match(/(\d+) day/);
    const extDays = daysMatch?.[1] || '';
    const dateDetail = extDays
      ? `${extDays} day${extDays !== '1' ? 's' : ''} (${fromDate} → ${toDate})`
      : refCharge?.reference || `Extension #${group.extensionNumber}`;

    const extRental = group.charges.find(
      (c) => c.category === 'Extension Rental' || c.category === 'Extension'
    );
    const tax = group.charges.find((c) => c.category === 'Extension Tax');
    const svcFee = group.charges.find((c) => c.category === 'Extension Service Fee');
    const insCharge = group.charges.find((c) => c.category === 'Extension Insurance');
    const insPolicy = group.insurancePolicy as any;
    const insuranceAmt = insCharge?.amount ?? insPolicy?.premium_amount ?? 0;

    const extRows: Row[] = [
      {
        label: 'Rental',
        category: extRental?.category || 'Extension Rental',
        amount: extRental?.amount ?? 0,
        detail: dateDetail,
        icon: Car,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        label: 'Tax',
        category: tax?.category || 'Extension Tax',
        amount: tax?.amount ?? 0,
        detail:
          tax && extRental
            ? `${((tax.amount / extRental.amount) * 100).toFixed(1)}% rate`
            : 'Tax on rental',
        icon: Percent,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
      },
      {
        label: insPolicy ? 'Bonzah Insurance' : 'Insurance',
        category: 'Extension Insurance',
        amount: insuranceAmt,
        detail: insPolicy ? 'Bonzah Insurance' : 'Insurance coverage',
        icon: ShieldCheck,
        color: 'text-teal-500',
        bg: 'bg-teal-500/10',
      },
      {
        label: 'Service Fee',
        category: svcFee?.category || 'Extension Service Fee',
        amount: svcFee?.amount ?? 0,
        detail: 'Platform fee',
        icon: Receipt,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
      },
    ];

    const selected = selectedExt[group.extensionNumber] || new Set<string>();
    const setSelected = (s: Set<string>) =>
      setSelectedExt((prev) => ({ ...prev, [group.extensionNumber]: s }));

    return renderTable(extRows, selected, setSelected);
  };

  const hasExtensions = extensionGroups.length > 0;

  if (!hasExtensions) {
    return (
      <Card className={isProcessing ? 'opacity-50 pointer-events-none' : ''}>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-medium">Payment Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {renderTable(originalRows, selectedOriginal, setSelectedOriginal)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isProcessing ? 'opacity-50 pointer-events-none' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Payment Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Accordion type="single" defaultValue="original" className="w-full space-y-3 px-4 pb-4">
          <AccordionItem value="original" className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline bg-green-500/5 data-[state=open]:border-b">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Car className="h-3 w-3 text-green-500" />
                </div>
                <span className="text-sm font-medium">Original Rental</span>
                <Badge variant="outline" className="text-[10px] ml-1">
                  {formatCurrency(invoice.totalAmount, currencyCode)}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-0 pb-0">
              {renderTable(originalRows, selectedOriginal, setSelectedOriginal)}
            </AccordionContent>
          </AccordionItem>

          {extensionGroups.map((group) => {
            const hasInsuranceCharge = group.charges.some(
              (c) => c.category === 'Extension Insurance'
            );
            const extInsAmt = hasInsuranceCharge
              ? 0
              : (group.insurancePolicy as any)?.premium_amount ?? 0;
            const extTotal = group.totalAmount + extInsAmt;
            return (
              <AccordionItem
                key={`ext-${group.extensionNumber}`}
                value={`extension-${group.extensionNumber}`}
                className="border rounded-lg overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-blue-500/5 data-[state=open]:border-b">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <CalendarPlus className="h-3 w-3 text-blue-500" />
                    </div>
                    <span className="text-sm font-medium">
                      Extension #{group.extensionNumber}
                    </span>
                    <Badge variant="outline" className="text-[10px] ml-1">
                      {formatCurrency(extTotal, currencyCode)}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-0 pb-0">
                  {renderExtensionTable(group)}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
