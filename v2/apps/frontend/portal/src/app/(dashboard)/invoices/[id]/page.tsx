'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@drive247/ui';
import { invoicesApi } from '@/lib/api';
import type {
  DiscountType,
  InvoiceDetail,
  InvoiceItemResponse,
  PaymentResponse,
  PaymentStatus,
} from '@drive247/shared-types';
import { formatCents } from '@/lib/money';
import { InvoiceStatusBadge } from '@/components/invoices/invoice-status-badge';
import { InvoiceTotalsCard } from '@/components/invoices/invoice-totals-card';
import {
  LineItemForm,
  type LineItemFormValues,
} from '@/components/invoices/line-item-form';
import { RecordPaymentDialog } from '@/components/invoices/record-payment-dialog';
import { RefundPaymentDialog } from '@/components/invoices/refund-payment-dialog';

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [recordPayOpen, setRecordPayOpen] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchInvoice = async () => {
    try {
      const { data: res } = await invoicesApi.getById(id);
      if (res.success) setInvoice(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (!invoice) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" asChild>
          <Link href="/invoices">Back to invoices</Link>
        </Button>
      </div>
    );
  }

  const isDraft = invoice.status === 'draft';
  const canVoid = invoice.amountPaid === 0 && invoice.status !== 'void' && invoice.status !== 'refunded';
  const canRecordPayment =
    invoice.status !== 'void' &&
    invoice.status !== 'refunded' &&
    invoice.amountDue > 0;

  const handleAddItem = async (values: LineItemFormValues) => {
    try {
      await invoicesApi.addItem(invoice.id, {
        description: values.description,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        discountType: values.discountType,
        discountValue: values.discountValue,
      });
      toast.success('Line item added');
      setAddItemOpen(false);
      fetchInvoice();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to add line item');
    }
  };

  const handleUpdateItem = async (
    itemId: string,
    values: LineItemFormValues,
  ) => {
    try {
      await invoicesApi.updateItem(invoice.id, itemId, {
        description: values.description,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        discountType: values.discountType,
        discountValue: values.discountValue,
      });
      toast.success('Line item updated');
      setEditItemId(null);
      fetchInvoice();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update');
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!confirm('Remove this line item?')) return;
    try {
      await invoicesApi.removeItem(invoice.id, itemId);
      toast.success('Line item removed');
      fetchInvoice();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to remove');
    }
  };

  const handleVoid = async () => {
    if (!confirm('Void this invoice? This cannot be undone.')) return;
    setBusy(true);
    try {
      await invoicesApi.void(invoice.id);
      toast.success('Invoice voided');
      fetchInvoice();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to void');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this invoice? This cannot be undone.')) return;
    setBusy(true);
    try {
      await invoicesApi.remove(invoice.id);
      toast.success('Invoice deleted');
      router.push('/invoices');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete');
      setBusy(false);
    }
  };

  const editingItem = invoice.items.find((i) => i.id === editItemId);
  const refundingPayment = invoice.payments.find(
    (p) => p.id === refundPaymentId,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/invoices" className="text-sm text-[#6366f1] hover:underline">
            ← Invoices
          </Link>
          <h2 className="text-[30px] font-medium text-[#080812] mt-1">
            {invoice.invoiceNumber}
          </h2>
          <InvoiceStatusBadge status={invoice.status} />
        </div>
        <div className="flex gap-2">
          {canVoid && (
            <Button variant="outline" onClick={handleVoid} disabled={busy}>
              Void
            </Button>
          )}
          {isDraft && (
            <Button
              variant="outline"
              className="text-[#dc2626]"
              onClick={handleDelete}
              disabled={busy}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="Name"
              value={
                <Link
                  href={`/customers/${invoice.customer.id}`}
                  className="text-[#6366f1] hover:underline"
                >
                  {invoice.customer.name}
                </Link>
              }
            />
            <Row label="Email" value={invoice.customer.email ?? '—'} />
            <Separator />
            <Row
              label="Rental"
              value={
                invoice.rental ? (
                  <Link
                    href={`/rentals/${invoice.rental.id}`}
                    className="text-[#6366f1] hover:underline"
                  >
                    {invoice.rental.startDate} → {invoice.rental.endDate}
                  </Link>
                ) : (
                  'Manual invoice'
                )
              }
            />
            <Row label="Due date" value={invoice.dueDate} />
          </CardContent>
        </Card>
        <InvoiceTotalsCard invoice={invoice} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Line Items</CardTitle>
          {isDraft && (
            <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
              <DialogTrigger asChild>
                <Button size="sm">+ Add line</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                  <DialogTitle>Add Line Item</DialogTitle>
                  <DialogDescription>
                    Custom charges — services, damages, extras, fees.
                  </DialogDescription>
                </DialogHeader>
                <LineItemForm
                  onSubmit={handleAddItem}
                  onCancel={() => setAddItemOpen(false)}
                  submitLabel="Add"
                />
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Description</TableHead>
                <TableHead className="text-[#6366f1] text-right">Qty</TableHead>
                <TableHead className="text-[#6366f1] text-right">Unit Price</TableHead>
                <TableHead className="text-[#6366f1] text-right">Discount</TableHead>
                <TableHead className="text-[#6366f1] text-right">Line Total</TableHead>
                {isDraft && (
                  <TableHead className="text-[#6366f1] text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatCents(item.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.discountAmount > 0
                      ? `− ${formatCents(item.discountAmount)}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCents(item.lineTotal)}
                  </TableCell>
                  {isDraft && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditItemId(item.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[#dc2626]"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editingItem && (
        <EditItemDialog
          item={editingItem}
          open
          onClose={() => setEditItemId(null)}
          onSubmit={(values) => handleUpdateItem(editingItem.id, values)}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Payments</CardTitle>
          {canRecordPayment && (
            <Dialog open={recordPayOpen} onOpenChange={setRecordPayOpen}>
              <DialogTrigger asChild>
                <Button size="sm">+ Record Payment</Button>
              </DialogTrigger>
              <RecordPaymentDialog
                invoiceId={invoice.id}
                amountDue={invoice.amountDue}
                onClose={() => setRecordPayOpen(false)}
                onRecorded={() => {
                  setRecordPayOpen(false);
                  fetchInvoice();
                }}
              />
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Date</TableHead>
                <TableHead className="text-[#6366f1] text-right">Amount</TableHead>
                <TableHead className="text-[#6366f1]">Method</TableHead>
                <TableHead className="text-[#6366f1]">Gateway</TableHead>
                <TableHead className="text-[#6366f1]">Status</TableHead>
                <TableHead className="text-[#6366f1]">Notes</TableHead>
                <TableHead className="text-[#6366f1] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6">
                    <span className="text-muted-foreground text-sm">
                      No payments yet
                    </span>
                  </TableCell>
                </TableRow>
              ) : (
                invoice.payments.map((p) => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    onRefund={() => setRefundPaymentId(p.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {refundingPayment && (
        <Dialog
          open
          onOpenChange={(open) => !open && setRefundPaymentId(null)}
        >
          <RefundPaymentDialog
            invoiceId={invoice.id}
            paymentId={refundingPayment.id}
            maxRefund={computeRefundable(refundingPayment, invoice.payments)}
            onClose={() => setRefundPaymentId(null)}
            onRefunded={() => {
              setRefundPaymentId(null);
              fetchInvoice();
            }}
          />
        </Dialog>
      )}

      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{invoice.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentRow({
  payment,
  onRefund,
}: {
  payment: PaymentResponse;
  onRefund: () => void;
}) {
  const canRefund =
    payment.type === 'payment' &&
    (payment.status as PaymentStatus) === 'succeeded';

  return (
    <TableRow>
      <TableCell>{new Date(payment.paidAt).toLocaleDateString()}</TableCell>
      <TableCell className="text-right">
        {payment.type === 'refund' ? '− ' : ''}
        {formatCents(Math.abs(payment.amount))}
      </TableCell>
      <TableCell className="capitalize">
        {payment.paymentMethod.replace('_', ' ')}
      </TableCell>
      <TableCell className="capitalize">{payment.paymentGateway}</TableCell>
      <TableCell className="capitalize">{payment.status}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {payment.notes ?? '—'}
      </TableCell>
      <TableCell className="text-right">
        {canRefund ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-[#dc2626]"
            onClick={onRefund}
          >
            Refund
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function EditItemDialog({
  item,
  open,
  onClose,
  onSubmit,
}: {
  item: InvoiceItemResponse;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: LineItemFormValues) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Line Item</DialogTitle>
          <DialogDescription>Update the line item details.</DialogDescription>
        </DialogHeader>
        <LineItemForm
          initial={{
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountType: item.discountType as DiscountType | null,
            discountValue: item.discountValue,
          }}
          onSubmit={onSubmit}
          onCancel={onClose}
          submitLabel="Save"
        />
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

// Compute refundable balance for a specific payment by subtracting prior refunds linked to it.
function computeRefundable(
  payment: PaymentResponse,
  allPayments: PaymentResponse[],
): number {
  if (payment.type !== 'payment') return 0;
  const refunds = allPayments.filter(
    (p) => p.linkedPaymentId === payment.id && p.status === 'succeeded',
  );
  const refunded = refunds.reduce((acc, p) => acc + Math.abs(p.amount), 0);
  return Math.max(0, payment.amount - refunded);
}
