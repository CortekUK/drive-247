'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarPlus, Check, X, AlertCircle, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface ExtensionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    end_date: string;
    previous_end_date: string | null;
    customers?: { id: string; name: string; email?: string };
    vehicles?: { id: string; reg: string; make: string; model: string };
  };
}

export function ExtensionRequestDialog({
  open,
  onOpenChange,
  rental,
}: ExtensionRequestDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const currentEndDate = new Date(rental.end_date);
  const requestedEndDate = rental.previous_end_date
    ? new Date(rental.previous_end_date)
    : null;

  const extensionDays = requestedEndDate
    ? Math.ceil((requestedEndDate.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const handleApprove = async () => {
    if (!requestedEndDate || !tenant?.id) return;

    setIsApproving(true);
    try {
      // Swap dates: end_date ↔ previous_end_date
      // Result: end_date = requested new date, previous_end_date = original date
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          end_date: rental.previous_end_date, // New end date (was in previous_end_date)
          previous_end_date: rental.end_date, // Store original end date
          is_extended: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        throw new Error(`Failed to approve extension: ${updateError.message}`);
      }

      // Create in-app notification for customer
      console.log('Creating approval notification for customer:', rental.customers?.id);
      if (rental.customers?.id) {
        const { data: customerUser, error: lookupError } = await supabase
          .from('customer_users')
          .select('id')
          .eq('customer_id', rental.customers.id)
          .maybeSingle();

        console.log('Customer user lookup:', { customerUser, lookupError });

        if (customerUser?.id) {
          const { error: notifError } = await supabase.from('customer_notifications').insert({
            customer_user_id: customerUser.id,
            tenant_id: tenant.id,
            title: 'Extension Approved',
            message: `Your extension request for ${rental.vehicles?.make} ${rental.vehicles?.model} has been approved. New end date: ${format(requestedEndDate, 'MMM dd, yyyy')}`,
            type: 'success',
            link: '/portal/bookings',
          });
          if (notifError) console.error('Failed to create customer notification:', notifError);
          else console.log('Customer notification created successfully');
        } else {
          console.warn('No customer_user found for customer_id:', rental.customers.id);
        }
      } else {
        console.warn('No customer id available for notification');
      }

      toast({
        title: 'Extension Approved',
        description: `Rental extended to ${format(requestedEndDate, 'MMMM dd, yyyy')}. Customer notified via email.`,
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Extension approval error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to approve extension',
        variant: 'destructive',
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!tenant?.id) return;

    setIsRejecting(true);
    try {
      // Clear extension fields
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          is_extended: false,
          previous_end_date: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        throw new Error(`Failed to reject extension: ${updateError.message}`);
      }

      // Create in-app notification for customer
      console.log('Creating rejection notification for customer:', rental.customers?.id);
      if (rental.customers?.id) {
        const { data: customerUser, error: lookupError } = await supabase
          .from('customer_users')
          .select('id')
          .eq('customer_id', rental.customers.id)
          .maybeSingle();

        console.log('Customer user lookup:', { customerUser, lookupError });

        if (customerUser?.id) {
          const { error: notifError } = await supabase.from('customer_notifications').insert({
            customer_user_id: customerUser.id,
            tenant_id: tenant.id,
            title: 'Extension Request Declined',
            message: `Your extension request for ${rental.vehicles?.make} ${rental.vehicles?.model} could not be approved. Please contact support if you have questions.`,
            type: 'alert',
            link: '/portal/bookings',
          });
          if (notifError) console.error('Failed to create customer notification:', notifError);
          else console.log('Customer notification created successfully');
        } else {
          console.warn('No customer_user found for customer_id:', rental.customers.id);
        }
      } else {
        console.warn('No customer id available for notification');
      }

      toast({
        title: 'Extension Rejected',
        description: 'The extension request has been declined. Customer notified via email.',
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Extension rejection error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to reject extension',
        variant: 'destructive',
      });
    } finally {
      setIsRejecting(false);
    }
  };

  const isProcessing = isApproving || isRejecting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-amber-600" />
            Extension Request
          </DialogTitle>
          <DialogDescription>
            {rental.customers?.name} has requested to extend their rental.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Vehicle Info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {rental.vehicles?.make} {rental.vehicles?.model}
            </Badge>
            <span>•</span>
            <span>{rental.vehicles?.reg}</span>
          </div>

          {/* Date Comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  Current End Date
                </span>
              </div>
              <p className="font-medium">{format(currentEndDate, 'MMM dd, yyyy')}</p>
            </div>

            <div className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-1">
                <CalendarPlus className="h-4 w-4 text-amber-600" />
                <span className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                  Requested Date
                </span>
              </div>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {requestedEndDate ? format(requestedEndDate, 'MMM dd, yyyy') : 'N/A'}
              </p>
            </div>
          </div>

          {/* Extension Duration */}
          {requestedEndDate && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This extends the rental by <strong>{extensionDays} days</strong>.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={isProcessing}
            className="flex-1 sm:flex-none"
          >
            {isRejecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Rejecting...
              </>
            ) : (
              <>
                <X className="h-4 w-4 mr-2" />
                Reject
              </>
            )}
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isProcessing || !requestedEndDate}
            className="flex-1 sm:flex-none"
          >
            {isApproving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Approve
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
