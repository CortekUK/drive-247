'use client';

import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Calendar, Car, AlertCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { format } from 'date-fns';
import type { CustomerRental } from '@/hooks/use-customer-rentals';

interface CancelBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: CustomerRental;
}

export function CancelBookingDialog({ open, onOpenChange, rental }: CancelBookingDialogProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const vehicleName = rental.vehicles
    ? rental.vehicles.make && rental.vehicles.model
      ? `${rental.vehicles.make} ${rental.vehicles.model}`
      : rental.vehicles.reg
    : 'Vehicle';

  const handleRequestClick = () => {
    if (!reason.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }
    setShowConfirmation(true);
  };

  const handleConfirmSubmit = async () => {
    if (isSubmittingRef.current) return;
    if (!reason.trim() || !tenant) {
      toast.error('Unable to submit. Please try again.');
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          cancellation_requested: true,
          cancellation_reason: reason.trim(),
        })
        .eq('id', rental.id);

      if (updateError) {
        throw new Error(`Failed to submit cancellation request: ${updateError.message}`);
      }

      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          tenant_id: tenant.id,
          type: 'booking',
          title: 'Cancellation Request',
          message: `Cancellation requested for ${rental.vehicles?.make || ''} ${rental.vehicles?.model || ''} (${rental.vehicles?.reg || 'N/A'}) - Reason: ${reason.trim().substring(0, 100)}`,
          link: `/rentals/${rental.id}`,
        });

      if (notifError) {
        console.error('Failed to create notification:', notifError);
      }

      toast.success('Cancellation request submitted successfully');

      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });

      handleClose();
    } catch (error: any) {
      console.error('Cancellation request error:', error);
      toast.error(error.message || 'Failed to submit cancellation request');
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason('');
    setShowConfirmation(false);
    onOpenChange(false);
  };

  const handleBack = () => {
    setShowConfirmation(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[90vw] sm:max-w-md">
        {!showConfirmation ? (
          <>
            <DialogHeader>
              <DialogTitle>Cancel Booking</DialogTitle>
              <DialogDescription>
                Request a cancellation for your booking. The admin will review your request.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Booking Summary */}
              <div className="p-3 rounded-lg bg-muted space-y-2">
                <div className="flex items-center gap-3">
                  <Car className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="font-medium">{vehicleName}</p>
                    {rental.vehicles?.reg && (
                      <p className="text-sm text-muted-foreground">{rental.vehicles.reg}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Booking Period</p>
                    <p className="text-sm font-medium">
                      {format(new Date(rental.start_date), 'MMM dd, yyyy')} -{' '}
                      {format(new Date(rental.end_date), 'MMM dd, yyyy')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Reason Input */}
              <div className="space-y-2">
                <Label htmlFor="cancel-reason">Reason for Cancellation</Label>
                <Textarea
                  id="cancel-reason"
                  placeholder="Please tell us why you'd like to cancel this booking..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Info Alert */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Your request will be reviewed by our team. Any applicable refund will be processed once the cancellation is approved.
                </AlertDescription>
              </Alert>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="flex-1 h-9"
                >
                  Close
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRequestClick}
                  disabled={!reason.trim()}
                  className="flex-1 h-9"
                >
                  Request Cancellation
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Confirm Cancellation Request
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Warning Alert */}
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="font-medium">
                  Are you sure you want to request cancellation of this booking?
                </AlertDescription>
              </Alert>

              {/* Summary */}
              <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Vehicle</span>
                  <span className="font-medium">{vehicleName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Dates</span>
                  <span className="font-medium">
                    {format(new Date(rental.start_date), 'MMM dd')} - {format(new Date(rental.end_date), 'MMM dd, yyyy')}
                  </span>
                </div>
                <div className="border-t pt-3">
                  <p className="text-sm text-muted-foreground mb-1">Reason</p>
                  <p className="text-sm">{reason}</p>
                </div>
              </div>

              {/* Confirmation Text */}
              <p className="text-sm text-muted-foreground text-center">
                By confirming, you are requesting to cancel this booking. The admin will review and process your request.
              </p>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={submitting}
                  className="flex-1 h-9"
                >
                  Go Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmSubmit}
                  disabled={submitting}
                  className="flex-1 h-9"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Confirm Request'
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
