'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Clock, CheckCircle, Loader2, Trash2, Mail, UserPlus, Users, XCircle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSecondaryDriver, type SecondaryDriver } from '@/hooks/use-secondary-driver';

const NOTICE =
  'The agreement and insurance cover the primary driver only. A secondary driver is not authorized to drive this vehicle under the agreement.';

const EMPTY_FORM = { name: '', email: '', phone: '' };

function StatusBadge({ driver }: { driver: SecondaryDriver }) {
  if (driver.verification_status === 'verified') {
    return (
      <Badge className="bg-green-100 text-green-800 gap-1">
        <CheckCircle className="h-3 w-3" />
        Verified
      </Badge>
    );
  }
  if (driver.verification_status === 'rejected') {
    return (
      <Badge className="bg-red-100 text-red-800 gap-1">
        <XCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 gap-1">
      <Clock className="h-3 w-3" />
      {driver.link_expired ? 'Link expired' : 'Pending'}
    </Badge>
  );
}

/**
 * The renter's secondary driver on a pending rental: add them, send their ID
 * link, see the result. Stays visible read-only after pick-up, and renders
 * nothing on a rental that never had one.
 */
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
      if (result.email_sent) {
        toast.success(`Verification link sent to ${form.email.trim()}`);
      } else {
        toast.error('Driver added, but the email did not send. Use Send new link to try again.');
      }
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Secondary Driver
            </CardTitle>
            {canManage && drivers.length === 0 && (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <UserPlus className="h-3 w-3 mr-1" />
                Add Secondary Driver
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {drivers.map((driver) => (
            <div key={driver.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{driver.name}</p>
                  {driver.email && <p className="text-xs text-muted-foreground">{driver.email}</p>}
                </div>
                <StatusBadge driver={driver} />
              </div>

              {driver.verification_status === 'rejected' && (
                <p className="text-sm text-muted-foreground">
                  The check did not pass. Make sure the name above matches their ID exactly and the ID has not
                  expired, then send a new link. To correct the name, remove this driver and add them again.
                </p>
              )}

              {canManage && (
                <div className="flex items-center gap-2">
                  {driver.verification_status !== 'verified' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResend(driver)}
                      disabled={resend.isPending}
                    >
                      {resend.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Mail className="h-3 w-3 mr-1" />
                      )}
                      Send new link
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(driver)}>
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}

          <p className="text-sm text-muted-foreground">{NOTICE}</p>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (add.isPending) return;
          setDialogOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Secondary Driver</DialogTitle>
              <DialogDescription>
                We will email them a secure link to verify their driving licence.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="secondary-driver-name">Full name (as shown on their ID)</Label>
              <Input
                id="secondary-driver-name"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary-driver-email">Email</Label>
              <Input
                id="secondary-driver-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary-driver-phone">Phone (optional)</Label>
              <Input
                id="secondary-driver-phone"
                type="tel"
                value={form.phone}
                onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
                autoComplete="off"
              />
            </div>

            <p className="text-sm text-muted-foreground">{NOTICE}</p>
            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={add.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Add and send link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !remove.isPending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be listed on this rental, and any verification link already sent will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep driver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleRemove();
              }}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
