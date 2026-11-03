'use client';

/**
 * The renter's secondary driver on a pending booking: add them, send their ID
 * link, see the result. Stays visible read-only after pick-up, and renders
 * nothing on a booking that never had one.
 *
 * Every write goes through the customer-secondary-driver edge function, which
 * checks ownership and that the booking is still pending. It never touches the
 * agreement, the insurance or the money.
 */

import { useState } from 'react';
import { CircleCheck, Clock, CircleX, Loader2 } from 'lucide-react-nw';
import { toast } from 'sonner-nw';

import { Panel, PanelHeader } from '@nw/components/portal/primitives';
import { StatusChip } from '@nw/components/portal/status-chip';
import { Button } from '@nw/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nw/components/ui/dialog';
import { Input } from '@nw/components/ui/input';
import { Label } from '@nw/components/ui/label';
import {
  SECONDARY_DRIVER_NOTICE,
  useSecondaryDriver,
  type SecondaryDriver,
} from '@nw/hooks/use-secondary-driver';
import { cn } from '@nw/lib/utils';

const EMPTY_FORM = { name: '', email: '', phone: '' };

function DriverStatus({ driver }: { driver: SecondaryDriver }) {
  if (driver.verification_status === 'verified') {
    return (
      <StatusChip tone="success" className="gap-1">
        <CircleCheck aria-hidden strokeWidth={1.75} className="size-3.5" />
        Verified
      </StatusChip>
    );
  }
  if (driver.verification_status === 'rejected') {
    return (
      <StatusChip tone="danger" className="gap-1">
        <CircleX aria-hidden strokeWidth={1.75} className="size-3.5" />
        Failed
      </StatusChip>
    );
  }
  return (
    <StatusChip tone="warning" className="gap-1">
      <Clock aria-hidden strokeWidth={1.75} className="size-3.5" />
      {driver.link_expired ? 'Link expired' : 'Pending'}
    </StatusChip>
  );
}

export function SecondaryDriverPanel({ rentalId }: { rentalId: string }) {
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
    <Panel>
      <PanelHeader
        title="Secondary driver"
        action={
          canManage && drivers.length === 0 ? (
            <Button type="button" size="sm" variant="brand-outline" onClick={() => setDialogOpen(true)}>
              Add Secondary Driver
            </Button>
          ) : undefined
        }
      />

      {drivers.length > 0 ? (
        <ul className="divide-y divide-brand-border-soft">
          {drivers.map((driver) => (
            <li key={driver.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-brand-text">{driver.name}</p>
                  {driver.email ? <p className="mt-0.5 text-xs text-brand-text-soft">{driver.email}</p> : null}
                </div>
                <DriverStatus driver={driver} />
              </div>

              {driver.verification_status === 'rejected' ? (
                <p className="text-xs leading-relaxed text-brand-text-soft">
                  The check did not pass. Make sure the name above matches their ID exactly and the ID has not
                  expired, then send a new link. To correct the name, remove this driver and add them again.
                </p>
              ) : null}

              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  {driver.verification_status !== 'verified' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="brand-outline"
                      disabled={resend.isPending}
                      onClick={() => {
                        void handleResend(driver);
                      }}
                    >
                      {resend.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                      Send new link
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="brand-ghost" onClick={() => setRemoving(driver)}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p
        className={cn(
          'px-4 py-3 text-xs leading-relaxed text-brand-text-subtle sm:px-5',
          drivers.length > 0 && 'border-t border-brand-border-soft',
        )}
      >
        {SECONDARY_DRIVER_NOTICE}
      </p>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (add.isPending) return;
          setDialogOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Add Secondary Driver</DialogTitle>
              <DialogDescription>
                We will email them a secure link to verify their driving licence.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nw-secondary-driver-name">Full name (as shown on their ID)</Label>
              <Input
                id="nw-secondary-driver-name"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                autoComplete="off"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nw-secondary-driver-email">Email</Label>
              <Input
                id="nw-secondary-driver-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
                autoComplete="off"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nw-secondary-driver-phone">Phone (optional)</Label>
              <Input
                id="nw-secondary-driver-phone"
                type="tel"
                value={form.phone}
                onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
                autoComplete="off"
              />
            </div>

            <p className="text-xs leading-relaxed text-brand-text-soft">{SECONDARY_DRIVER_NOTICE}</p>
            {formError ? <p className="text-sm text-danger">{formError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="brand-outline" disabled={add.isPending} onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" disabled={add.isPending}>
                {add.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                Add and send link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
      >
        <DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              They will no longer be listed on this booking, and any verification link already sent will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="brand-outline" disabled={remove.isPending} onClick={() => setRemoving(null)}>
              Keep driver
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={remove.isPending}
              onClick={() => {
                void handleRemove();
              }}
            >
              {remove.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
