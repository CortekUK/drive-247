import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import { closeRentalSchema, type CloseRentalFormValues } from "@/client-schemas/rentals/close-rental";
import { useTenant } from "@/contexts/TenantContext";

type CloseRentalFormData = CloseRentalFormValues;

interface Rental {
  id: string;
  rental_number: string;
  customer: {
    id: string;
    name: string;
  };
  vehicle: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
  start_date: string;
  monthly_amount: number;
}

interface CloseRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: Rental | null;
}

export const CloseRentalDialog = ({ open, onOpenChange, rental }: CloseRentalDialogProps) => {
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  
  const form = useForm<CloseRentalFormData>({
    resolver: zodResolver(closeRentalSchema),
    defaultValues: {
      end_date: new Date(),
    },
  });

  const closeRentalMutation = useMutation({
    mutationFn: async (data: CloseRentalFormData) => {
      if (!rental) throw new Error('No rental selected');

      // Update rental status to Closed
      let rentalQuery = supabase
        .from('rentals')
        .update({
          status: 'Closed',
          end_date: formatInTimeZone(data.end_date, 'America/New_York', 'yyyy-MM-dd'),
          updated_at: new Date().toISOString()
        })
        .eq('id', rental.id);

      if (tenant?.id) {
        rentalQuery = rentalQuery.eq('tenant_id', tenant.id);
      }

      const { error: rentalError } = await rentalQuery;

      if (rentalError) throw rentalError;

      // Update vehicle status to Available
      let vehicleQuery = supabase
        .from('vehicles')
        .update({ status: 'Available' })
        .eq('id', rental.vehicle.id);

      if (tenant?.id) {
        vehicleQuery = vehicleQuery.eq('tenant_id', tenant.id);
      }

      const { error: vehicleError } = await vehicleQuery;

      if (vehicleError) throw vehicleError;
    },
    onSuccess: () => {
      toast({
        title: "Rental Closed",
        description: `Rental ${rental?.rental_number} has been successfully closed and vehicle is now available.`,
      });
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['rentals'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      
      handleClose();
    },
    onError: (error) => {
      console.error('Error closing rental:', error);
      toast({
        title: "Error",
        description: "Failed to close rental. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setStep('details');
    form.reset({ end_date: new Date() });
    onOpenChange(false);
  };

  const handleNext = () => {
    setStep('confirm');
  };

  const handleBack = () => {
    setStep('details');
  };

  const onSubmit = (data: CloseRentalFormData) => {
    closeRentalMutation.mutate(data);
  };

  if (!rental) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Close Rental Agreement
          </DialogTitle>
          <DialogDescription>
            This will permanently close rental {rental.rental_number}. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {step === 'details' && (
          <div className="space-y-4">
            {/* Rental Details */}
            <div className="rounded-lg bg-muted p-4 space-y-2">
              <h3 className="font-medium">Rental Details</h3>
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Rental:</span> {rental.rental_number}</p>
                <p><span className="font-medium">Customer:</span> {rental.customer.name}</p>
                <p><span className="font-medium">Vehicle:</span> {rental.vehicle.reg} ({rental.vehicle.make} {rental.vehicle.model})</p>
                <p><span className="font-medium">Start Date:</span> {new Date(rental.start_date).toLocaleDateString()}</p>
                <p><span className="font-medium">Monthly Amount:</span> ${rental.monthly_amount.toLocaleString()}</p>
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleNext)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date <span className="text-red-500">*</span></FormLabel>
                      <Popover modal={true}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                formatInTimeZone(field.value, 'America/New_York', "MM/dd/yyyy")
                              ) : (
                                <span>Pick end date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            fromDate={new Date(rental.start_date)}
                            toDate={new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    Next
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <Alert className="border-orange-200 bg-orange-50">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-orange-800">
                <strong>Warning:</strong> This will permanently close the rental agreement. 
                The rental status will be changed to "Closed" and the end date will be set to {formatInTimeZone(form.getValues('end_date'), 'America/New_York', "MM/dd/yyyy")}.
              </AlertDescription>
            </Alert>

            <div className="rounded-lg bg-muted p-4 space-y-2">
              <h3 className="font-medium">Summary</h3>
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Rental:</span> {rental.rental_number}</p>
                <p><span className="font-medium">Customer:</span> {rental.customer.name}</p>
                <p><span className="font-medium">Vehicle:</span> {rental.vehicle.reg}</p>
                <p><span className="font-medium">End Date:</span> {formatInTimeZone(form.getValues('end_date'), 'America/New_York', "MM/dd/yyyy")}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button 
                type="button" 
                variant="destructive"
                onClick={() => onSubmit(form.getValues())}
                disabled={closeRentalMutation.isPending}
              >
                {closeRentalMutation.isPending ? "Closing..." : "Close Rental"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};