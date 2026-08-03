'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * "Force Logout All Users" — one implementation, rendered from both the
 * Settings page and the Feedbacks settings panel.
 *
 * Extracted rather than copy-pasted on purpose: this signs out every operator
 * and every customer on the platform. Two independent copies of that would
 * inevitably drift, and the copy nobody remembered to update is the dangerous
 * one.
 */
export function ForceLogoutAllControl({ className }: { className?: string }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGlobalForceLogout = async () => {
    if (confirmText !== 'LOGOUT ALL') return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-force-logout', {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(
        `Successfully logged out ${data.successCount} user${data.successCount !== 1 ? 's' : ''} across all tenants`
      );
      if (data.failCount > 0) {
        toast.error(
          `${data.failCount} user${data.failCount !== 1 ? 's' : ''} could not be logged out`
        );
      }
      setShowConfirm(false);
      setConfirmText('');
    } catch (error: any) {
      toast.error(`Failed to force logout: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setShowConfirm(true)}
        className={className}
      >
        Force Logout All
      </Button>

      <Dialog
        open={showConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setShowConfirm(false);
            setConfirmText('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force Logout ALL Users</DialogTitle>
            <DialogDescription>
              This will immediately sign out every portal staff member and every booking
              customer across all tenants on the platform. Super admins will not be affected.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4">
            <p className="text-sm text-destructive">
              This action cannot be undone. All users will need to sign in again.
            </p>
          </div>

          <div>
            <Label className="mb-2 block">
              Type <strong>LOGOUT ALL</strong> to confirm:
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="LOGOUT ALL"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirm(false);
                setConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleGlobalForceLogout}
              disabled={loading || confirmText !== 'LOGOUT ALL'}
            >
              {loading ? 'Logging out...' : 'Force Logout Everyone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
