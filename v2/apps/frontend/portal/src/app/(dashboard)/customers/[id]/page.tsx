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
  DialogTrigger,
  Separator,
} from '@drive247/ui';
import { customersApi } from '@/lib/api';
import type {
  CustomerFinancialsResponse,
  CustomerResponse,
} from '@drive247/shared-types';
import { EditCustomerDialog } from '@/components/customers/edit-customer-dialog';
import { IdentityVerificationTab } from '@/components/id-verification/identity-verification-tab';
import { formatCents } from '@/lib/money';

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerResponse | null>(null);
  const [financials, setFinancials] = useState<CustomerFinancialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchCustomer = async () => {
    try {
      const { data: res } = await customersApi.getById(id);
      if (res.success) setCustomer(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  };

  const fetchFinancials = async () => {
    try {
      const { data: res } = await customersApi.financials(id);
      if (res.success) setFinancials(res.data);
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    fetchCustomer();
    fetchFinancials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDelete = async () => {
    if (!confirm('Delete this customer? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await customersApi.remove(id);
      toast.success('Customer deleted');
      router.push('/customers');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete customer');
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Customer not found.</p>
        <Button variant="outline" asChild>
          <Link href="/customers">Back to customers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/customers"
            className="text-sm text-[#6366f1] hover:underline"
          >
            ← Customers
          </Link>
          <h2 className="text-[30px] font-medium text-[#080812] mt-1">
            {customer.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {customer.email || customer.phone || '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit</Button>
            </DialogTrigger>
            <EditCustomerDialog
              customer={customer}
              onClose={() => setEditOpen(false)}
              onUpdated={() => {
                setEditOpen(false);
                fetchCustomer();
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

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Name" value={customer.name} />
            <Row label="Email" value={customer.email ?? '—'} />
            <Row label="Phone" value={customer.phone ?? '—'} />
            <Row
              label="Status"
              value={
                customer.status === 'active' ? (
                  <span className="text-[#16a34a] font-medium">Active</span>
                ) : (
                  <span className="text-[#dc2626] font-medium">Inactive</span>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="Total invoiced"
              value={formatCents(financials?.totalInvoiced ?? 0)}
            />
            <Row
              label="Total paid"
              value={formatCents(financials?.totalPaid ?? 0)}
            />
            <Row
              label="Outstanding"
              value={
                <span
                  className={
                    (financials?.outstanding ?? 0) > 0
                      ? 'text-[#dc2626] font-medium'
                      : undefined
                  }
                >
                  {formatCents(financials?.outstanding ?? 0)}
                </span>
              }
            />
            <Separator />
            <Row
              label="Last payment"
              value={
                financials?.lastPaymentAt
                  ? new Date(financials.lastPaymentAt).toLocaleDateString()
                  : '—'
              }
            />
          </CardContent>
        </Card>
      </div>

      <IdentityVerificationTab customerId={customer.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <Row label="Customer ID" value={customer.id} />
          <Row
            label="Created"
            value={new Date(customer.createdAt).toLocaleDateString()}
          />
          <Row
            label="Updated"
            value={new Date(customer.updatedAt).toLocaleDateString()}
          />
        </CardContent>
      </Card>
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
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
