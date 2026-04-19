'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@drive247/ui';
import { invoicesApi } from '@/lib/api';
import { DiscountType } from '@drive247/shared-types';
import type { CustomerResponse } from '@drive247/shared-types';
import { formatCents, parseToCents } from '@/lib/money';
import { CustomerPicker } from '@/components/rentals/customer-picker';

interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

const DISC_NONE = 'none';

export default function NewInvoicePage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerResponse | null>(null);
  const [dueDate, setDueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<string>(DISC_NONE);
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { description: '', quantity: 1, unitPrice: 0, discountType: null, discountValue: null },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { description: '', quantity: 1, unitPrice: 0, discountType: null, discountValue: null },
    ]);
  };
  const removeLine = (idx: number) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const subtotalCents = lines.reduce((acc, l) => {
    const gross = l.quantity * l.unitPrice;
    const disc = calcDiscount(gross, l.discountType, l.discountValue);
    return acc + (gross - disc);
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) {
      toast.error('Please select a customer');
      return;
    }
    if (lines.some((l) => !l.description.trim() || l.quantity <= 0 || l.unitPrice < 0)) {
      toast.error('All line items need a description, quantity ≥ 1, and price ≥ 0');
      return;
    }

    setSubmitting(true);
    try {
      const { data: res } = await invoicesApi.create({
        customerId: customer.id,
        rentalId: null,
        dueDate,
        notes: notes.trim() || null,
        discountType:
          invoiceDiscountType === DISC_NONE
            ? null
            : (invoiceDiscountType as DiscountType),
        discountValue:
          invoiceDiscountType === DISC_NONE
            ? null
            : invoiceDiscountType === DiscountType.PERCENTAGE
              ? Number(invoiceDiscountValue)
              : parseToCents(invoiceDiscountValue),
        items: lines,
      });
      if (res.success) {
        toast.success('Invoice created');
        router.push(`/invoices/${res.data.id}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create invoice');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/invoices" className="text-sm text-[#6366f1] hover:underline">
          ← Invoices
        </Link>
        <h2 className="text-[30px] font-medium text-[#080812] mt-1">New Invoice</h2>
        <p className="text-sm text-muted-foreground">
          Manual invoice (no rental attached). Useful for damages, late fees, or extras.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardContent className="space-y-5 p-6">
            <CustomerPicker value={customer} onChange={setCustomer} />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dueDate">Due date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>
            </div>

            <Separator />

            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium">Line Items</h3>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  + Add line
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff]">
                    <TableHead className="text-[#6366f1]">Description</TableHead>
                    <TableHead className="text-[#6366f1] text-right w-20">Qty</TableHead>
                    <TableHead className="text-[#6366f1] text-right w-32">Unit Price</TableHead>
                    <TableHead className="text-[#6366f1] w-32">Disc Type</TableHead>
                    <TableHead className="text-[#6366f1] text-right w-24">Disc Value</TableHead>
                    <TableHead className="text-[#6366f1] text-right w-28">Total</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => {
                    const gross = line.quantity * line.unitPrice;
                    const disc = calcDiscount(gross, line.discountType, line.discountValue);
                    const lineTotal = gross - disc;
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <Input
                            value={line.description}
                            onChange={(e) =>
                              updateLine(idx, { description: e.target.value })
                            }
                            required
                            maxLength={200}
                            className="bg-white"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(idx, { quantity: Number(e.target.value) })
                            }
                            className="bg-white text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={line.unitPrice ? (line.unitPrice / 100).toFixed(2) : ''}
                            onChange={(e) =>
                              updateLine(idx, {
                                unitPrice: parseToCents(e.target.value),
                              })
                            }
                            className="bg-white text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={line.discountType ?? DISC_NONE}
                            onValueChange={(v) =>
                              updateLine(idx, {
                                discountType:
                                  v === DISC_NONE ? null : (v as DiscountType),
                                discountValue: null,
                              })
                            }
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={DISC_NONE}>None</SelectItem>
                              <SelectItem value={DiscountType.PERCENTAGE}>%</SelectItem>
                              <SelectItem value={DiscountType.FIXED}>Fixed</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            disabled={!line.discountType}
                            value={
                              line.discountValue == null
                                ? ''
                                : line.discountType === DiscountType.PERCENTAGE
                                  ? String(line.discountValue)
                                  : (line.discountValue / 100).toFixed(2)
                            }
                            onChange={(e) =>
                              updateLine(idx, {
                                discountValue:
                                  line.discountType === DiscountType.PERCENTAGE
                                    ? Number(e.target.value)
                                    : parseToCents(e.target.value),
                              })
                            }
                            className="bg-white text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCents(lineTotal)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-[#dc2626]"
                            onClick={() => removeLine(idx)}
                            disabled={lines.length === 1}
                          >
                            ✕
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Invoice-level discount</Label>
                <Select
                  value={invoiceDiscountType}
                  onValueChange={(v) => {
                    setInvoiceDiscountType(v);
                    setInvoiceDiscountValue('');
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DISC_NONE}>None</SelectItem>
                    <SelectItem value={DiscountType.PERCENTAGE}>Percentage</SelectItem>
                    <SelectItem value={DiscountType.FIXED}>Fixed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invDiscVal">
                  Amount{invoiceDiscountType === DiscountType.PERCENTAGE ? ' (%)' : ''}
                </Label>
                <Input
                  id="invDiscVal"
                  type="number"
                  step="0.01"
                  min={0}
                  value={invoiceDiscountValue}
                  onChange={(e) => setInvoiceDiscountValue(e.target.value)}
                  disabled={invoiceDiscountType === DISC_NONE}
                  className="bg-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                className="bg-white"
              />
            </div>

            <div className="flex justify-between items-center pt-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Subtotal: </span>
                <span className="font-medium">{formatCents(subtotalCents)}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  (tax applied at creation)
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/invoices')}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Invoice'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function calcDiscount(
  gross: number,
  type: DiscountType | null,
  value: number | null,
): number {
  if (!type || value == null) return 0;
  let amt = type === DiscountType.PERCENTAGE ? Math.round((gross * value) / 100) : value;
  if (amt > gross) amt = gross;
  return amt;
}
