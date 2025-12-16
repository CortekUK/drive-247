import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { authorityPaymentSchema, type AuthorityPaymentFormValues } from "@/client-schemas/fines/authority-payment";

interface AuthorityPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fineId: string;
  fineAmount: number;
  fineReference?: string;
}

export function AuthorityPaymentDialog({
  open,
  onOpenChange,
  fineId,
  fineAmount,
  fineReference,
}: AuthorityPaymentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<AuthorityPaymentFormValues>({
    resolver: zodResolver(authorityPaymentSchema),
    defaultValues: {
      amount: fineAmount,
      paymentDate: new Date(),
      paymentMethod: "",
      notes: "",
    },
  });

  const createAuthorityPayment = useMutation({
    mutationFn: async (values: AuthorityPaymentFormValues) => {
      const { data, error } = await supabase.functions.invoke('record-authority-payment', {
        body: {
          fineId,
          amount: values.amount,
          paymentDate: format(values.paymentDate, 'yyyy-MM-dd'),
          paymentMethod: values.paymentMethod,
          notes: values.notes,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to record authority payment');
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Authority Payment Recorded",
        description: `Payment of $${form.getValues('amount')} recorded successfully`,
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["fine", fineId] });
      queryClient.invalidateQueries({ queryKey: ["authority-payments", fineId] });
      queryClient.invalidateQueries({ queryKey: ["pl-summary"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-pl"] });
      
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      console.error("Error recording authority payment:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to record authority payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: AuthorityPaymentFormValues) => {
    createAuthorityPayment.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Record Authority Payment</DialogTitle>
          <DialogDescription>
            Record a payment made to the authority for fine {fineReference || fineId.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount Paid</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Enter amount"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Payment Date</FormLabel>
                  <Popover>
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
                            format(field.value, "PPP")
                          ) : (
                            <span>Pick a date</span>
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
                        disabled={(date) =>
                          date > new Date() || date < new Date("1900-01-01")
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="card">Card Payment</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes about this payment..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createAuthorityPayment.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createAuthorityPayment.isPending}
              >
                {createAuthorityPayment.isPending ? "Recording..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}