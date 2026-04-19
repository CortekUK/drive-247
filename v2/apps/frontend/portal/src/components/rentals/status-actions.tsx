'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@drive247/ui';
import { rentalsApi } from '@/lib/api';
import type { RentalStatus } from '@drive247/shared-types';

interface Props {
  rentalId: string;
  status: RentalStatus;
  onChanged: () => void;
}

const NEXT_ACTIONS: Record<
  RentalStatus,
  { label: string; next: RentalStatus; variant?: 'outline' | 'default' }[]
> = {
  pending: [
    { label: 'Activate', next: 'active' as RentalStatus, variant: 'default' },
    { label: 'Cancel', next: 'cancelled' as RentalStatus, variant: 'outline' },
  ],
  active: [
    { label: 'Complete', next: 'completed' as RentalStatus, variant: 'default' },
    { label: 'Cancel', next: 'cancelled' as RentalStatus, variant: 'outline' },
  ],
  completed: [],
  cancelled: [],
};

export function StatusActions({ rentalId, status, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const actions = NEXT_ACTIONS[status] ?? [];

  if (actions.length === 0) return null;

  const handle = async (next: RentalStatus, label: string) => {
    setBusy(next);
    try {
      await rentalsApi.transition(rentalId, { status: next } as never);
      toast.success(`Rental ${label.toLowerCase()}`);
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || `Failed to ${label.toLowerCase()}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex gap-2">
      {actions.map((a) => (
        <Button
          key={a.next}
          variant={a.variant ?? 'outline'}
          disabled={busy !== null}
          onClick={() => handle(a.next, a.label)}
          className={
            a.label === 'Cancel' ? 'text-[#dc2626]' : undefined
          }
        >
          {busy === a.next ? `${a.label}...` : a.label}
        </Button>
      ))}
    </div>
  );
}
