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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Calendar, AlertCircle, RefreshCw, Car } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { format, addDays, parseISO, differenceInDays } from 'date-fns';
import type { CustomerRental } from '@/hooks/use-customer-rentals';

interface RenewRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: CustomerRental;
}

export function RenewRentalDialog({ open, onOpenChange, rental }: RenewRentalDialogProps) {
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  // Calculate defaults based on source rental
  const sourceStartDate = parseISO(rental.start_date);
  const sourceEndDate = parseISO(rental.end_date);
  const sourceDuration = differenceInDays(sourceEndDate, sourceStartDate);
  const defaultStart = sourceEndDate > new Date() ? addDays(sourceEndDate, 1) : addDays(new Date(), 1);
  const defaultEnd = addDays(defaultStart, sourceDuration);

  const [newStartDate, setNewStartDate] = useState(format(defaultStart, 'yyyy-MM-dd'));
  const [newEndDate, setNewEndDate] = useState(format(defaultEnd, 'yyyy-MM-dd'));
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const selectedStart = newStartDate ? parseISO(newStartDate) : null;
  const selectedEnd = newEndDate ? parseISO(newEndDate) : null;
  const newDuration = selectedStart && selectedEnd ? differenceInDays(selectedEnd, selectedStart) : 0;

  const vehicleName = rental.vehicles
    ? `${rental.vehicles.make || ''} ${rental.vehicles.model || ''}`.trim() || rental.vehicles.reg
    : 'Vehicle';

  const handleReviewClick = () => {
    if (!newStartDate || !newEndDate) {
      toast.error('Please select start and end dates');
      return;
    }
    if (selectedEnd && selectedStart && selectedEnd <= selectedStart) {
      toast.error('End date must be after start date');
      return;
    }
    setShowConfirmation(true);
  };

  const handleConfirmSubmit = async () => {
    if (isSubmittingRef.current) return;
    if (!newStartDate || !newEndDate || !tenant || !customerUser?.customer_id || !rental.vehicles) {
      toast.error('Unable to submit. Please try again.');
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      const { error: insertError } = await supabase
        .from('rentals')
        .insert({
          customer_id: customerUser.customer_id,
          vehicle_id: rental.vehicles.id,
          start_date: newStartDate,
          end_date: newEndDate,
          rental_period_type: rental.rental_period_type || 'Monthly',
          monthly_amount: rental.monthly_amount,
          status: 'Pending',
          source: 'customer_portal',
          tenant_id: tenant.id,
          pickup_location: rental.pickup_location || null,
          return_location: rental.return_location || null,
          insurance_status: 'pending',
          renewed_from_rental_id: rental.id,
        });

      if (insertError) {
        throw new Error(`Failed to create renewal: ${insertError.message}`);
      }

      // Create notification for admin
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          tenant_id: tenant.id,
          type: 'booking',
          title: 'Rental Renewal Request',
          message: `Renewal requested for ${vehicleName} (${rental.vehicles.reg}) — ${format(parseISO(newStartDate), 'MMM dd, yyyy')} to ${format(parseISO(newEndDate), 'MMM dd, yyyy')}`,
          link: `/rentals`,
        });

      if (notifError) {
        console.error('Failed to create notification:', notifError);
      }

      toast.success('Renewal request submitted successfully');
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      handleClose();
    } catch (error: any) {
      console.error('Renewal request error:', error);
      toast.error(error.message || 'Failed to submit renewal request');
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setNewStartDate(format(defaultStart, 'yyyy-MM-dd'));
    setNewEndDate(format(defaultEnd, 'yyyy-MM-dd'));
    setShowConfirmation(false);
    onOpenChange(false);
  };

  const handleBack = () => {
    setShowConfirmation(false);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[90vw] sm:max-w-md">
        {!showConfirmation ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Renew Rental
              </DialogTitle>
              <DialogDescription>
                Create a new rental based on your completed one.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Source rental info */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <Car className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="font-medium">{vehicleName}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(sourceStartDate, 'MMM dd, yyyy')} — {format(sourceEndDate, 'MMM dd, yyyy')}
                  </p>
                  <p className="text-sm font-medium mt-0.5">
                    {formatCurrency(rental.monthly_amount)} / {rental.rental_period_type?.toLowerCase() || 'month'}
                  </p>
                </div>
              </div>

              {/* Date selection */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="renew-start-date">Start Date</Label>
                  <Input
                    id="renew-start-date"
                    type="date"
                    value={newStartDate}
                    onChange={(e) => {
                      setNewStartDate(e.target.value);
                      // Auto-adjust end date to maintain same duration
                      if (e.target.value) {
                        const newStart = parseISO(e.target.value);
                        setNewEndDate(format(addDays(newStart, sourceDuration), 'yyyy-MM-dd'));
                      }
                    }}
                    min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="renew-end-date">End Date</Label>
                  <Input
                    id="renew-end-date"
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    min={newStartDate || format(addDays(new Date(), 2), 'yyyy-MM-dd')}
                    className="w-full"
                  />
                </div>
              </div>

              {newDuration > 0 && (
                <p className="text-sm text-muted-foreground text-center">
                  Duration: <strong>{newDuration} days</strong>
                </p>
              )}

              {/* Info Alert */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Your renewal will be submitted for admin approval. The same vehicle and rate will be used.
                </AlertDescription>
              </Alert>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={handleClose} className="flex-1 h-9">
                  Cancel
                </Button>
                <Button
                  onClick={handleReviewClick}
                  disabled={!newStartDate || !newEndDate}
                  className="flex-1 h-9"
                >
                  Review Renewal
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Confirm Renewal
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Renewal Summary */}
              <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Vehicle</span>
                  <span className="font-medium">{vehicleName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Start Date</span>
                  <span className="font-medium">{selectedStart ? format(selectedStart, 'MMM dd, yyyy') : '-'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">End Date</span>
                  <span className="font-medium text-primary">{selectedEnd ? format(selectedEnd, 'MMM dd, yyyy') : '-'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Duration</span>
                  <span className="font-medium">{newDuration} days</span>
                </div>
                <div className="border-t pt-3 flex justify-between items-center">
                  <span className="text-sm font-medium">Rate</span>
                  <span className="font-bold text-lg">
                    {formatCurrency(rental.monthly_amount)} / {rental.rental_period_type?.toLowerCase() || 'month'}
                  </span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground text-center">
                By confirming, a new rental will be created and submitted for approval.
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
                    'Confirm Renewal'
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
