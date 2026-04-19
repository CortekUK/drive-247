'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { rentalsApi } from '@/lib/api';
import {
  RentalForm,
  blankRentalForm,
  type RentalFormValue,
} from '@/components/rentals/rental-form';

export default function NewRentalPage() {
  const router = useRouter();
  const [form, setForm] = useState<RentalFormValue>(blankRentalForm());
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.customer || !form.vehicle) return;
    setSubmitting(true);
    try {
      const { data: res } = await rentalsApi.create({
        customerId: form.customer.id,
        vehicleId: form.vehicle.id,
        startDate: form.startDate,
        endDate: form.endDate,
        periodType: form.periodType,
        totalAmount: Number(form.totalAmount),
      } as never);
      if (res.success) {
        toast.success('Rental created');
        router.push(`/rentals/${res.data.id}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create rental');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/rentals" className="text-sm text-[#6366f1] hover:underline">
          ← Rentals
        </Link>
        <h2 className="text-[30px] font-medium text-[#080812] mt-1">New Rental</h2>
        <p className="text-sm text-muted-foreground">
          Select a customer, vehicle, dates, and total amount. Status starts as pending.
        </p>
      </div>

      <RentalForm
        value={form}
        onChange={setForm}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Create rental"
        secondary={{
          label: 'Cancel',
          onClick: () => router.push('/rentals'),
        }}
      />
    </div>
  );
}
