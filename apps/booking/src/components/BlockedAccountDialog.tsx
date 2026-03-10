'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';

interface BlockedAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BlockedAccountDialog({
  open,
  onOpenChange,
}: BlockedAccountDialogProps) {
  const { tenant } = useTenant();

  const supportEmail = tenant?.support_email || tenant?.email;
  const supportPhone = tenant?.support_phone || tenant?.phone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <DialogTitle className="text-xl">Account Blocked</DialogTitle>
          <DialogDescription className="text-center">
            Your account has been blocked. Please contact support for assistance.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-4">
          {supportEmail && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(`mailto:${supportEmail}`, '_blank')}
            >
              Contact Support
            </Button>
          )}
          {supportPhone && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(`tel:${supportPhone}`, '_blank')}
            >
              Call {supportPhone}
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
