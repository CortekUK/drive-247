'use client';

/**
 * The renter's secondary driver on a pending rental: add them, send their ID
 * link, see the result. Stays visible read-only after pick-up, and renders
 * nothing on a rental that never had one.
 *
 * Every write goes through the customer-secondary-driver edge function, which
 * checks ownership and that the rental is still pending. It never touches the
 * agreement, the insurance or the money.
 */

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react-nw';
import { toast } from 'sonner-nw';

import { Button } from '@nw/components/ui/button';
import { Input } from '@nw/components/ui/input';
import { Label } from '@nw/components/ui/label';
import {
  SECONDARY_DRIVER_NOTICE,
  useSecondaryDriver,
  type SecondaryDriver,
} from '@nw/hooks/use-secondary-driver';
import { PvDialogContent, PvDialogHeader, PvStatus } from '@nw/portal-v2/dialog';
import { StatusChip } from '@nw/portal-v2/status-chip';
import { cn } from '@nw/lib/utils';
import { Card, CardAction, CardHeader, CardTitle } from '@portal-v2-shared/card';

import {
  PV_BUTTON,
  PV_BUTTON_DANGER,
  PV_BUTTON_GHOST,
  PV_BUTTON_GHOST_SM,
  PV_BUTTON_OUTLINE_SM,
  PV_INPUT,
} from '../../settings/_components/pv-kit';

const EMPTY_FORM = { name: '', email: '', phone: '' };
const FOOTER_BUTTON = 'h-11 w-full px-6 sm:w-auto sm:min-w-[9rem]';

function DriverStatus({ driver }: { driver: SecondaryDriver }) {
  if (driver.verification_status === 'verified') return <StatusChip tone="success">Verified</StatusChip>;
  if (driver.verification_status === 'rejected') return <StatusChip tone="danger">Failed</StatusChip>;
  return <StatusChip tone="warning">{driver.link_expired ? 'Link expired' : 'Pending'}</StatusChip>;
}

export function SecondaryDriverCard({ rentalId }: { rentalId: string }) {
  const { canManage, drivers, add, resend, remove } = useSecondaryDriver(rentalId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SecondaryDriver | null>(null);

  if (!canManage && drivers.length === 0) return null;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      const result = await add.mutateAsync(form);
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      if (result.email_sent) toast.success(`Verification link sent to ${form.email.trim()}`);
      else toast.error('Driver added, but the email did not send. Use Send new link to try again.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not add this driver.');
    }
  };

  const handleResend = async (driver: SecondaryDriver) => {
    try {
      const result = await resend.mutateAsync(driver.id);
      if (result.email_sent) toast.success(`New link sent to ${driver.email}`);
      else toast.error('The email did not send. Please try again.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send a new link.');
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast.success(`${removing.name} was removed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove this driver.');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-pv-border py-4">
          <CardTitle>Secondary driver</CardTitle>
          {canManage && drivers.length === 0 ? (
            <CardAction>
              <Button type="button" variant="ghost" className={PV_BUTTON_OUTLINE_SM} onClick={() => setDialogOpen(true)}>
                Add Secondary Driver
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>

        {drivers.map((driver) => (
          <div key={driver.id} className="flex flex-col gap-2 border-b border-pv-border px-6 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-pv-fg">{driver.name}</p>
                {driver.email ? <p className="mt-0.5 text-xs text-pv-muted-fg">{driver.email}</p> : null}
              </div>
              <DriverStatus driver={driver} />
            </div>

            {driver.verification_status === 'rejected' ? (
              <p className="text-[13px] leading-relaxed text-pv-muted-fg">
                The check did not pass. Make sure the name above matches their ID exactly and the ID has not expired,
                then send a new link. To correct the name, remove this driver and add them again.
              </p>
            ) : null}

            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                {driver.verification_status !== 'verified' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={PV_BUTTON_OUTLINE_SM}
                    disabled={resend.isPending}
                    onClick={() => {
                      void handleResend(driver);
                    }}
                  >
                    {resend.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                    Send new link
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" className={PV_BUTTON_GHOST_SM} onClick={() => setRemoving(driver)}>
                  Remove
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        <p className="px-6 py-3 text-[13px] leading-relaxed text-pv-muted-fg">{SECONDARY_DRIVER_NOTICE}</p>
      </Card>

      <DialogPrimitive.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (add.isPending) return;
          setDialogOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <PvDialogContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-6">
            <PvDialogHeader
              title="Add Secondary Driver"
              description="We will email them a secure link to verify their driving licence."
            />

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv-secondary-driver-name">Full name (as shown on their ID)</Label>
                <Input
                  id="pv-secondary-driver-name"
                  className={PV_INPUT}
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv-secondary-driver-email">Email</Label>
                <Input
                  id="pv-secondary-driver-email"
                  type="email"
                  className={PV_INPUT}
                  value={form.email}
                  onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pv-secondary-driver-phone">Phone (optional)</Label>
                <Input
                  id="pv-secondary-driver-phone"
                  type="tel"
                  className={PV_INPUT}
                  value={form.phone}
                  onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
                  autoComplete="off"
                />
              </div>
            </div>

            <p className="text-[13px] leading-relaxed text-pv-muted-fg">{SECONDARY_DRIVER_NOTICE}</p>
            {formError ? <p className="text-[13px] text-pv-danger">{formError}</p> : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                className={cn(PV_BUTTON_GHOST, FOOTER_BUTTON)}
                disabled={add.isPending}
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="ghost" className={cn(PV_BUTTON, FOOTER_BUTTON)} disabled={add.isPending}>
                {add.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                Add and send link
              </Button>
            </div>
          </form>
        </PvDialogContent>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
      >
        <PvDialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
          <PvDialogHeader
            title={`Remove ${removing?.name ?? 'this driver'}?`}
            description="They will no longer be listed on this rental, and any verification link already sent will stop working."
            status={removing ? <PvStatus tone="neutral">Secondary driver</PvStatus> : undefined}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className={cn(PV_BUTTON_GHOST, FOOTER_BUTTON)}
              disabled={remove.isPending}
              onClick={() => setRemoving(null)}
            >
              Keep driver
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(PV_BUTTON_DANGER, FOOTER_BUTTON)}
              disabled={remove.isPending}
              onClick={() => {
                void handleRemove();
              }}
            >
              {remove.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              {remove.isPending ? 'Removing…' : 'Remove driver'}
            </Button>
          </div>
        </PvDialogContent>
      </DialogPrimitive.Root>
    </>
  );
}
