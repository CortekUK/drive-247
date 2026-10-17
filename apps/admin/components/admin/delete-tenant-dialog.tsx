'use client';

/**
 * Delete a rental company — the one confirmation, used by the company page and
 * the Rental Companies list alike. The company's name has to be typed back
 * before the button wakes up: this removes every vehicle, customer, rental,
 * payment and user it has, and cannot be undone.
 */

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deleteTenant } from '@/lib/tenant-actions';

export function DeleteTenantDialog({
  tenant,
  onOpenChange,
  onDeleted,
}: {
  /** The company to delete; null keeps the dialog closed. */
  tenant: { id: string; company_name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful delete (navigate away, or reload the list). */
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setConfirmName('');
    setDeleting(false);
  }, [tenant?.id]);

  const close = (open: boolean) => {
    if (deleting) return;
    if (!open) setConfirmName('');
    onOpenChange(open);
  };

  const confirm = async () => {
    if (!tenant || confirmName !== tenant.company_name) {
      toast.error('Company name does not match');
      return;
    }
    setDeleting(true);
    try {
      await deleteTenant(tenant.id);
      toast.success(`${tenant.company_name} and all its data were deleted`);
      setDeleting(false);
      onOpenChange(false);
      onDeleted();
    } catch (error: any) {
      toast.error(`Error deleting tenant: ${error.message}`);
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!tenant} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Tenant</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive ring-1 ring-destructive/25">
          <p>
            This will permanently delete <strong>{tenant?.company_name}</strong> and ALL associated data including
            vehicles, customers, rentals, payments, and users.
          </p>
          <p className="font-semibold">This action cannot be undone!</p>
        </div>
        <div className="space-y-2">
          <Label>
            Type <strong className="text-foreground">{tenant?.company_name}</strong> to confirm:
          </Label>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder="Enter company name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={deleting || confirmName !== tenant?.company_name}>
            {deleting ? 'Deleting...' : 'Delete Permanently'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
