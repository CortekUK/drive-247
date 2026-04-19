'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Separator,
} from '@drive247/ui';
import { bonzahApi, customersApi, invoicesApi, rentalsApi } from '@/lib/api';
import type {
  BonzahPolicyResponse,
  CustomerResponse,
  InvoiceListItem,
  RentalDetail,
  RentalPeriodType,
  RenterDetails,
} from '@drive247/shared-types';
import { StatusActions } from '@/components/rentals/status-actions';
import {
  RentalForm,
  type RentalFormValue,
} from '@/components/rentals/rental-form';
import { formatCents } from '@/lib/money';
import { InvoiceStatusBadge } from '@/components/invoices/invoice-status-badge';
import { InsuranceSelectorDialog } from '@/components/bonzah/insurance-selector-dialog';
import { PolicyViewerCard } from '@/components/bonzah/policy-viewer-card';

const statusColor: Record<string, string> = {
  pending: 'text-[#d97706]',
  active: 'text-[#16a34a]',
  completed: 'text-[#2563eb]',
  cancelled: 'text-[#dc2626]',
};

export default function RentalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [rental, setRental] = useState<RentalDetail | null>(null);
  const [invoice, setInvoice] = useState<InvoiceListItem | null>(null);
  const [policies, setPolicies] = useState<BonzahPolicyResponse[]>([]);
  const [customer, setCustomer] = useState<CustomerResponse | null>(null);
  const [insuranceOpen, setInsuranceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchRental = async () => {
    try {
      const { data: res } = await rentalsApi.getById(id);
      if (res.success) setRental(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load rental');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvoice = async () => {
    try {
      const { data: res } = await invoicesApi.list({ rentalId: id, limit: 1 } as never);
      if (res.success) setInvoice(res.data.items[0] ?? null);
    } catch {
      // non-fatal
    }
  };

  const fetchPolicies = async () => {
    try {
      const { data: res } = await bonzahApi.listPolicies({ rentalId: id });
      if (res.success) setPolicies(res.data.items);
    } catch {
      // non-fatal — section stays empty
    }
  };

  const fetchCustomer = async (customerId: string) => {
    try {
      const { data: res } = await customersApi.getById(customerId);
      if (res.success) setCustomer(res.data);
    } catch {
      // non-fatal — renter form falls back to empty defaults
    }
  };

  useEffect(() => {
    fetchRental();
    fetchInvoice();
    fetchPolicies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (rental?.customer.id) fetchCustomer(rental.customer.id);
  }, [rental?.customer.id]);

  const handleDelete = async () => {
    if (!confirm('Delete this rental? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await rentalsApi.remove(id);
      toast.success('Rental deleted');
      router.push('/rentals');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete rental');
      setDeleting(false);
    }
  };

  const formatMoney = (value: string) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'GBP',
    }).format(Number(value));

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!rental) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Rental not found.</p>
        <Button variant="outline" asChild>
          <Link href="/rentals">Back to rentals</Link>
        </Button>
      </div>
    );
  }

  const isTerminal =
    rental.status === 'completed' || rental.status === 'cancelled';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/rentals"
            className="text-sm text-[#6366f1] hover:underline"
          >
            ← Rentals
          </Link>
          <h2 className="text-[30px] font-medium text-[#080812] mt-1">
            Rental
          </h2>
          <p className={`text-sm font-medium capitalize ${statusColor[rental.status] ?? ''}`}>
            {rental.status}
          </p>
        </div>
        <div className="flex gap-2">
          <StatusActions
            rentalId={rental.id}
            status={rental.status}
            onChanged={fetchRental}
          />
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isTerminal}>
                Edit
              </Button>
            </DialogTrigger>
            <EditRentalDialog
              rental={rental}
              onClose={() => setEditOpen(false)}
              onUpdated={() => {
                setEditOpen(false);
                fetchRental();
              }}
            />
          </Dialog>
          <Button
            variant="outline"
            className="text-[#dc2626]"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      {invoice && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Payment Summary</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/invoices/${invoice.id}`}>View Invoice</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Invoice</div>
              <div className="font-medium">{invoice.invoiceNumber}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="font-medium">{formatCents(invoice.totalAmount)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Paid</div>
              <div className="font-medium">{formatCents(invoice.amountPaid)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Due</div>
              <div className="font-medium">{formatCents(invoice.amountDue)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="Name"
              value={
                <Link
                  href={`/customers/${rental.customer.id}`}
                  className="text-[#6366f1] hover:underline"
                >
                  {rental.customer.name}
                </Link>
              }
            />
            <Row label="Email" value={rental.customer.email ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="Reg"
              value={
                <Link
                  href={`/vehicles/${rental.vehicle.id}`}
                  className="text-[#6366f1] hover:underline"
                >
                  {rental.vehicle.reg}
                </Link>
              }
            />
            <Row
              label="Model"
              value={`${rental.vehicle.make} ${rental.vehicle.model}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Start" value={rental.startDate} />
            <Row label="End" value={rental.endDate} />
            <Row
              label="Period"
              value={<span className="capitalize">{rental.periodType}</span>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Amount</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Total" value={formatMoney(rental.totalAmount)} />
            <Separator />
            <Row
              label="Created"
              value={new Date(rental.createdAt).toLocaleDateString()}
            />
            <Row
              label="Updated"
              value={new Date(rental.updatedAt).toLocaleDateString()}
            />
          </CardContent>
        </Card>
      </div>

      {/* Insurance section — show existing policies OR "Add" button */}
      {policies.length > 0 ? (
        <PolicyViewerCard policies={policies} onChanged={() => {
          fetchPolicies();
          fetchRental();
        }} />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Insurance</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                No Bonzah policy attached to this rental yet.
              </p>
            </div>
            <Dialog open={insuranceOpen} onOpenChange={setInsuranceOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!customer}>
                  Add Bonzah Insurance
                </Button>
              </DialogTrigger>
              {customer && (
                <InsuranceSelectorDialog
                  rental={rental}
                  defaultRenter={buildDefaultRenter(customer)}
                  onClose={() => setInsuranceOpen(false)}
                  onQuoted={() => {
                    setInsuranceOpen(false);
                    fetchPolicies();
                    fetchRental();
                  }}
                />
              )}
            </Dialog>
          </CardHeader>
        </Card>
      )}
    </div>
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

/**
 * Prefill the Bonzah renter form from the customer record. Unknown fields
 * (license, address) start empty — admin fills them in the form.
 */
function buildDefaultRenter(customer: CustomerResponse): RenterDetails {
  // customer.name may be "First Last" — naive split
  const [firstName = '', ...rest] = customer.name.split(' ');
  const lastName = rest.join(' ');
  const phoneDigits = (customer.phone ?? '').replace(/\D/g, '');
  return {
    firstName,
    lastName,
    dob: '',
    email: customer.email ?? '',
    phone: phoneDigits,
    address: { street: '', city: '', state: '', zip: '' },
    license: { number: '', state: '' },
  };
}

function EditRentalDialog({
  rental,
  onClose,
  onUpdated,
}: {
  rental: RentalDetail;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [form, setForm] = useState<RentalFormValue>({
    customer: {
      id: rental.customer.id,
      name: rental.customer.name,
      email: rental.customer.email,
    } as never,
    vehicle: {
      id: rental.vehicle.id,
      reg: rental.vehicle.reg,
      make: rental.vehicle.make,
      model: rental.vehicle.model,
    } as never,
    startDate: rental.startDate,
    endDate: rental.endDate,
    periodType: rental.periodType as RentalPeriodType,
    totalAmount: rental.totalAmount,
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await rentalsApi.update(rental.id, {
        startDate: form.startDate,
        endDate: form.endDate,
        periodType: form.periodType,
        totalAmount: Number(form.totalAmount),
      } as never);
      toast.success('Rental updated');
      onUpdated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update rental');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Edit Rental</DialogTitle>
        <DialogDescription>
          Customer and vehicle cannot be changed. Update dates, period, or amount.
        </DialogDescription>
      </DialogHeader>
      <RentalForm
        value={form}
        onChange={setForm}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Save changes"
        secondary={{ label: 'Cancel', onClick: onClose }}
        lockCustomerAndVehicle
      />
    </DialogContent>
  );
}
