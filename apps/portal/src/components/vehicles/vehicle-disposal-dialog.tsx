import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon, AlertTriangle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useVehicleDisposal, DisposalData } from "@/hooks/use-vehicle-disposal";
import { Card, CardContent } from "@/components/ui/card";
import { vehicleDisposalSchema, type VehicleDisposalFormValues } from "@/client-schemas/vehicles/vehicle-disposal";

type DisposalFormData = VehicleDisposalFormValues;

interface Vehicle {
  id: string;
  reg: string;
  make?: string;
  model?: string;
  acquisition_type?: string;
  purchase_price?: number;
  initial_payment?: number;
  monthly_payment?: number;
  term_months?: number;
  balloon?: number;
  is_disposed?: boolean;
  disposal_date?: string;
  sale_proceeds?: number;
  disposal_buyer?: string;
  disposal_notes?: string;
}

interface VehicleDisposalDialogProps {
  vehicle: Vehicle;
  onDisposal?: () => void;
}

export function VehicleDisposalDialog({ vehicle, onDisposal }: VehicleDisposalDialogProps) {
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [bookCost, setBookCost] = useState<number | null>(null);
  const [gainLoss, setGainLoss] = useState<number | null>(null);
  
  const { disposeVehicle, calculateBookCost, isDisposing, isCalculatingBookCost } = useVehicleDisposal(vehicle.id);

  const form = useForm<DisposalFormData>({
    resolver: zodResolver(vehicleDisposalSchema),
    defaultValues: {
      disposal_date: new Date(),
      sale_proceeds: 0,
      disposal_buyer: "",
      disposal_notes: "",
    },
  });

  const saleProceeds = form.watch("sale_proceeds");

  useEffect(() => {
    if (open && bookCost === null) {
      calculateBookCost().then(setBookCost).catch(console.error);
    }
  }, [open, bookCost, calculateBookCost]);

  useEffect(() => {
    if (bookCost !== null && saleProceeds > 0) {
      setGainLoss(saleProceeds - bookCost);
    } else {
      setGainLoss(null);
    }
  }, [bookCost, saleProceeds]);

  const onSubmit = async (data: DisposalFormData) => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    try {
      const disposalData: DisposalData = {
        disposal_date: format(data.disposal_date, 'yyyy-MM-dd'),
        sale_proceeds: data.sale_proceeds,
        disposal_buyer: data.disposal_buyer,
        disposal_notes: data.disposal_notes,
      };

      await disposeVehicle(disposalData);
      setOpen(false);
      setShowConfirm(false);
      onDisposal?.();
      form.reset();
    } catch (error) {
      console.error('Failed to dispose vehicle:', error);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setShowConfirm(false);
      form.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-2 w-full">
          <Trash2 className="h-5 w-5 shrink-0" />
          Dispose Vehicle
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dispose Vehicle</DialogTitle>
          <DialogDescription>
            Record the disposal of {vehicle.reg} ({vehicle.make} {vehicle.model})
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="disposal_date"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Disposal Date</FormLabel>
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
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sale_proceeds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sale Proceeds ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="disposal_buyer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Buyer/Dealer (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter buyer name or dealer" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="disposal_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes about the disposal..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {(bookCost !== null || gainLoss !== null) && (
              <Card>
                <CardContent className="pt-4">
                  <div className="space-y-2 text-sm">
                    {isCalculatingBookCost ? (
                      <div>Calculating book cost...</div>
                    ) : (
                      <>
                        {bookCost !== null && (
                          <div className="flex justify-between">
                            <span>Book Cost:</span>
                            <span className="font-mono">${bookCost.toFixed(2)}</span>
                          </div>
                        )}
                        {saleProceeds > 0 && (
                          <div className="flex justify-between">
                            <span>Sale Proceeds:</span>
                            <span className="font-mono">${saleProceeds.toFixed(2)}</span>
                          </div>
                        )}
                        {gainLoss !== null && (
                          <div className={cn(
                            "flex justify-between font-semibold border-t pt-2",
                            gainLoss > 0 ? "text-green-600" : gainLoss < 0 ? "text-red-600" : "text-gray-600"
                          )}>
                            <span>{gainLoss > 0 ? "Gain:" : gainLoss < 0 ? "Loss:" : "Break-even:"}</span>
                            <span className="font-mono">
                              {gainLoss !== 0 && (gainLoss > 0 ? "+" : "")}${Math.abs(gainLoss).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {showConfirm && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium mb-1">Confirm Disposal</p>
                    <p>
                      This will mark the vehicle as Disposed and post P&L gain/loss. 
                      Action is reversible only by Admin.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (showConfirm) {
                    setShowConfirm(false);
                  } else {
                    handleOpenChange(false);
                  }
                }}
              >
                {showConfirm ? "Back" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant={showConfirm ? "destructive" : "default"}
                disabled={isDisposing}
              >
                {isDisposing ? "Processing..." : showConfirm ? "Confirm Disposal" : "Next"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}