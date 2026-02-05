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
import { Loader2, Calendar, AlertCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { format, addDays, parseISO, differenceInDays } from 'date-fns';
import type { CustomerRental } from '@/hooks/use-customer-rentals';

interface ExtendRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: CustomerRental;
}

export function ExtendRentalDialog({ open, onOpenChange, rental }: ExtendRentalDialogProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const [newEndDate, setNewEndDate] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  // Calculate minimum date (must be after current end date)
  const currentEndDate = parseISO(rental.end_date);
  const minDate = format(addDays(currentEndDate, 1), 'yyyy-MM-dd');

  // Calculate extension days
  const selectedDate = newEndDate ? parseISO(newEndDate) : null;
  const extensionDays = selectedDate ? differenceInDays(selectedDate, currentEndDate) : 0;

  const handleRequestClick = () => {
    if (!newEndDate) {
      toast.error('Please select a new end date');
      return;
    }

    if (selectedDate && selectedDate <= currentEndDate) {
      toast.error('New end date must be after the current end date');
      return;
    }

    setShowConfirmation(true);
  };

  const handleConfirmSubmit = async () => {
    if (isSubmittingRef.current) return;
    if (!newEndDate || !tenant || !selectedDate) {
      toast.error('Unable to submit. Please try again.');
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      // Update rental with extension request
      // is_extended = true, previous_end_date = requested new end date
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          is_extended: true,
          previous_end_date: newEndDate,
        })
        .eq('id', rental.id);

      if (updateError) {
        throw new Error(`Failed to submit extension request: ${updateError.message}`);
      }

      // Create notification for admin
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          tenant_id: tenant.id,
          type: 'booking',
          title: 'Rental Extension Request',
          message: `Extension requested for ${rental.vehicles?.make || ''} ${rental.vehicles?.model || ''} (${rental.vehicles?.reg || 'N/A'}) - New end date: ${format(selectedDate, 'MMM dd, yyyy')}`,
          link: `/rentals/${rental.id}`,
        });

      if (notifError) {
        console.error('Failed to create notification:', notifError);
      }

      toast.success('Extension request submitted successfully');

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });

      handleClose();
    } catch (error: any) {
      console.error('Extension request error:', error);
      toast.error(error.message || 'Failed to submit extension request');
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setNewEndDate('');
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
              <DialogTitle>Extend Rental</DialogTitle>
              <DialogDescription>
                Request an extension for your rental. The admin will review your request.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Current End Date Info */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">Current End Date</p>
                  <p className="font-medium">{format(currentEndDate, 'MMMM dd, yyyy')}</p>
                </div>
              </div>

              {/* New End Date Input */}
              <div className="space-y-2">
                <Label htmlFor="new-end-date">New End Date</Label>
                <Input
                  id="new-end-date"
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  min={minDate}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Select a date after {format(currentEndDate, 'MMM dd, yyyy')}
                </p>
              </div>

              {/* Info Alert */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Your request will be reviewed by our team. You will be notified once it&apos;s approved or if additional information is needed.
                </AlertDescription>
              </Alert>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="flex-1 h-9"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRequestClick}
                  disabled={!newEndDate}
                  className="flex-1 h-9"
                >
                  Request Extension
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                Confirm Extension Request
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Warning Alert */}
              <Alert variant="destructive" className="border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="font-medium">
                  This action cannot be undone!
                </AlertDescription>
              </Alert>

              {/* Extension Summary */}
              <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Current End Date</span>
                  <span className="font-medium">{format(currentEndDate, 'MMM dd, yyyy')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New End Date</span>
                  <span className="font-medium text-primary">{selectedDate ? format(selectedDate, 'MMM dd, yyyy') : '-'}</span>
                </div>
                <div className="border-t pt-3 flex justify-between items-center">
                  <span className="text-sm font-medium">Extension Period</span>
                  <span className="font-bold text-lg text-amber-600">+{extensionDays} days</span>
                </div>
              </div>

              {/* Confirmation Text */}
              <p className="text-sm text-muted-foreground text-center">
                By confirming, you are requesting to extend your rental by <strong>{extensionDays} days</strong>. The admin will review and approve your request.
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
                  className="flex-1 h-9 bg-amber-600 hover:bg-amber-700"
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
