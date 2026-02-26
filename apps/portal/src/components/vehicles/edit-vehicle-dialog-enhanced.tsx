import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Edit, Car, DollarSign, CalendarIcon, Lock, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuditLog } from "@/hooks/use-audit-log";
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { getContractTotal } from "@/lib/vehicle-utils";
import { editVehicleEnhancedSchema, type EditVehicleEnhancedFormValues } from "@/client-schemas/vehicles/edit-vehicle-enhanced";
import { useTenant } from "@/contexts/TenantContext";
import { getCurrencySymbol } from "@/lib/format-utils";
import { useRentalSettings } from "@/hooks/use-rental-settings";

type VehicleFormData = EditVehicleEnhancedFormValues;

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  colour: string;
  fuel_type?: string;
  purchase_price?: number;
  acquisition_date: string;
  acquisition_type: string;
  // Finance fields for backward compatibility
  monthly_payment?: number;
  initial_payment?: number;
  term_months?: number;
  balloon?: number;
  // Rent fields
  daily_rent?: number;
  weekly_rent?: number;
  monthly_rent?: number;
  mot_due_date?: string;
  tax_due_date?: string;
  warranty_start_date?: string;
  warranty_end_date?: string;
  has_logbook?: boolean;
  has_service_plan?: boolean;
  has_spare_key?: boolean;
  spare_key_holder?: string | null;
  spare_key_notes?: string | null;
  has_tracker?: boolean;
  has_remote_immobiliser?: boolean;
  security_notes?: string | null;
  vin?: string | null;
  description?: string | null;
  security_deposit?: number | null;
  allowed_mileage?: number | null;
  excess_mileage_rate?: number | null;
  lockbox_code?: string | null;
  lockbox_instructions?: string | null;
  available_daily?: boolean;
  available_weekly?: boolean;
  available_monthly?: boolean;
}

interface EditVehicleDialogProps {
  vehicle: Vehicle;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const EditVehicleDialogEnhanced = ({ vehicle, open, onOpenChange }: EditVehicleDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();
  const { tenant } = useTenant();
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'GBP');
  const { settings: rentalSettings } = useRentalSettings();
  const [lockboxCode, setLockboxCode] = useState(vehicle.lockbox_code || '');
  const [lockboxInstructions, setLockboxInstructions] = useState(vehicle.lockbox_instructions || '');

  const generateLockboxCode = () => {
    const length = rentalSettings?.lockbox_code_length || 4;
    const max = Math.pow(10, length);
    const code = Math.floor(Math.random() * max).toString().padStart(length, '0');
    setLockboxCode(code);
  };

  // Calculate contract total for existing finance vehicles
  const existingContractTotal = vehicle.acquisition_type === 'Finance' 
    ? getContractTotal(vehicle)
    : undefined;
  
  const form = useForm<VehicleFormData>({
    resolver: zodResolver(editVehicleEnhancedSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      reg: vehicle.reg,
      vin: vehicle.vin || '',
      make: vehicle.make,
      model: vehicle.model,
      colour: vehicle.colour || '',
      fuel_type: (vehicle.fuel_type as 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric') || 'Petrol',
      purchase_price: vehicle.purchase_price,
      contract_total: existingContractTotal,
      acquisition_date: vehicle.acquisition_date ? new Date(vehicle.acquisition_date) : new Date(),
      acquisition_type: vehicle.acquisition_type ? (vehicle.acquisition_type as 'Purchase' | 'Finance') : undefined,
      daily_rent: vehicle.daily_rent ?? 0,
      weekly_rent: vehicle.weekly_rent ?? 0,
      monthly_rent: vehicle.monthly_rent ?? 0,
      mot_due_date: vehicle.mot_due_date ? new Date(vehicle.mot_due_date) : undefined,
      tax_due_date: vehicle.tax_due_date ? new Date(vehicle.tax_due_date) : undefined,
      warranty_start_date: vehicle.warranty_start_date ? new Date(vehicle.warranty_start_date) : undefined,
      warranty_end_date: vehicle.warranty_end_date ? new Date(vehicle.warranty_end_date) : undefined,
      has_logbook: vehicle.has_logbook || false,
      has_service_plan: vehicle.has_service_plan || false,
      has_spare_key: vehicle.has_spare_key || false,
      spare_key_holder: vehicle.spare_key_holder ? (vehicle.spare_key_holder as 'Company' | 'Customer') : (vehicle.has_spare_key ? 'Company' : undefined),
      spare_key_notes: vehicle.spare_key_notes || "",
      has_tracker: vehicle.has_tracker || false,
      has_remote_immobiliser: vehicle.has_remote_immobiliser || false,
      security_notes: vehicle.security_notes || "",
      description: vehicle.description || "",
      security_deposit: vehicle.security_deposit ?? undefined,
      allowed_mileage: vehicle.allowed_mileage ?? undefined,
      excess_mileage_rate: vehicle.excess_mileage_rate ?? undefined,
      available_daily: vehicle.available_daily ?? true,
      available_weekly: vehicle.available_weekly ?? true,
      available_monthly: vehicle.available_monthly ?? true,
    },
  });

  const handleOpenChange = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    } else {
      setIsOpen(newOpen);
    }
  };

  const currentOpen = open !== undefined ? open : isOpen;

  const onSubmit = async (data: VehicleFormData) => {
    console.log('=== EDIT VEHICLE FORM SUBMITTED ===');
    console.log('Form data:', data);
    setLoading(true);

    try {
      // Normalize registration
      const normalizedReg = data.reg.toUpperCase().trim();
      console.log('Normalized reg:', normalizedReg);
      
      const vehicleData: any = {
        reg: normalizedReg,
        vin: data.vin || null,
        make: data.make,
        model: data.model,
        colour: data.colour,
        fuel_type: data.fuel_type,
        acquisition_type: data.acquisition_type || null,
        acquisition_date: format(data.acquisition_date, 'yyyy-MM-dd'),
        daily_rent: data.daily_rent || null,
        weekly_rent: data.weekly_rent || null,
        monthly_rent: data.monthly_rent || null,
        mot_due_date: data.mot_due_date ? format(data.mot_due_date, 'yyyy-MM-dd') : undefined,
        tax_due_date: data.tax_due_date ? format(data.tax_due_date, 'yyyy-MM-dd') : undefined,
        warranty_start_date: data.warranty_start_date ? format(data.warranty_start_date, 'yyyy-MM-dd') : undefined,
        warranty_end_date: data.warranty_end_date ? format(data.warranty_end_date, 'yyyy-MM-dd') : undefined,
        has_logbook: data.has_logbook,
        has_service_plan: data.has_service_plan,
        has_spare_key: data.has_spare_key,
        spare_key_holder: data.has_spare_key ? data.spare_key_holder : null,
        spare_key_notes: data.has_spare_key ? data.spare_key_notes : null,
        description: data.description || null,
        has_tracker: data.has_tracker,
        has_remote_immobiliser: data.has_remote_immobiliser,
        security_notes: data.security_notes || null,
        security_deposit: data.security_deposit || null,
        allowed_mileage: data.allowed_mileage || null,
        excess_mileage_rate: data.excess_mileage_rate || null,
        lockbox_code: lockboxCode || null,
        lockbox_instructions: lockboxInstructions || null,
        available_daily: data.available_daily,
        available_weekly: data.available_weekly,
        available_monthly: data.available_monthly,
      };

      // Add type-specific fields
      if (data.acquisition_type === 'Purchase') {
        vehicleData.purchase_price = data.purchase_price;
        // Clear finance fields
        vehicleData.monthly_payment = null;
        vehicleData.initial_payment = null;
        vehicleData.term_months = null;
        vehicleData.balloon = null;
      } else if (data.acquisition_type === 'Finance') {
        // For finance vehicles, convert contract total to the structure expected by triggers
        vehicleData.initial_payment = data.contract_total;
        vehicleData.monthly_payment = 1; // Dummy value to satisfy constraints
        vehicleData.term_months = 1; // Dummy value
        vehicleData.balloon = 0;
        // Clear purchase price
        vehicleData.purchase_price = null;
      }

      console.log('Updating vehicle with data:', vehicleData);

      const { error } = await supabase
        .from("vehicles")
        .update(vehicleData)
        .eq('id', vehicle.id);

      console.log('Update result - Error:', error);

      if (error) throw error;

      // Audit log for vehicle update
      logAction({
        action: "vehicle_updated",
        entityType: "vehicle",
        entityId: vehicle.id,
        details: { reg: normalizedReg, make: data.make, model: data.model }
      });

      toast({
        title: "Vehicle Updated",
        description: `${data.make} ${data.model} (${normalizedReg}) has been updated successfully.`,
      });

      handleOpenChange(false);

      // Refresh the vehicle data and P&L data
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicle.id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-pl"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    } catch (error: any) {
      console.error('=== EDIT VEHICLE ERROR ===');
      console.error('Error object:', error);
      console.error('Error code:', error?.code);
      console.error('Error message:', error?.message);
      console.error('Error details:', error?.details);

      let errorMessage = "Failed to update vehicle. Please try again.";

      if (error?.code === '23505' && error?.details?.includes('vehicles_reg_key')) {
        errorMessage = `A vehicle with registration '${data.reg}' already exists. Please use a different registration number.`;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      console.log('=== EDIT VEHICLE COMPLETE ===');
      setLoading(false);
    }
  };

  const isControlled = open !== undefined;

  return (
    <Dialog open={currentOpen} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Edit className="h-4 w-4 mr-2" />
            Edit Vehicle
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            Edit Vehicle: {vehicle.reg}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              form.handleSubmit((data) => {
                // Manual validation for conditional required fields
                let hasErrors = false;

                if (data.acquisition_type === 'Purchase' && (data.purchase_price === undefined || data.purchase_price === null)) {
                  form.setError('purchase_price', {
                    type: 'manual',
                    message: 'Purchase price is required for purchased vehicles'
                  });
                  hasErrors = true;
                }

                if (data.acquisition_type === 'Finance' && (data.contract_total === undefined || data.contract_total === null)) {
                  form.setError('contract_total', {
                    type: 'manual',
                    message: 'Contract total is required for financed vehicles'
                  });
                  hasErrors = true;
                }

                if (hasErrors) return;

                onSubmit(data);
              }, (errors) => {
                const firstError = Object.values(errors)[0];
                const message = firstError?.message || (firstError as any)?.root?.message || "Please check all required fields.";
                toast({
                  title: "Validation Error",
                  description: String(message),
                  variant: "destructive",
                });
              })(e);
            }}
            className="space-y-4 px-1"
          >
            {/* Lockbox Section - top of form when tenant has lockbox enabled */}
            {rentalSettings?.lockbox_enabled && (
              <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                <Lock className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Input
                    placeholder={rentalSettings.lockbox_code_length ? `${rentalSettings.lockbox_code_length}-digit code` : 'Lockbox code'}
                    value={lockboxCode}
                    onChange={(e) => {
                      const val = rentalSettings.lockbox_code_length
                        ? e.target.value.replace(/[^0-9]/g, '').slice(0, rentalSettings.lockbox_code_length)
                        : e.target.value;
                      setLockboxCode(val);
                    }}
                    className="w-36 font-mono tracking-widest text-center text-lg h-9"
                    maxLength={rentalSettings.lockbox_code_length || undefined}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateLockboxCode}
                    className="flex items-center gap-1.5 h-9"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Generate
                  </Button>
                </div>
                <Input
                  placeholder="Instructions (optional)"
                  value={lockboxInstructions}
                  onChange={(e) => setLockboxInstructions(e.target.value)}
                  className="flex-1 h-9 text-sm"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="reg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License Plate Number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. AB12 CDE"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>VIN</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 1HGBH41JXMN109186"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="acquisition_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Acquisition Date</FormLabel>
                    <Popover modal={true}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick acquisition date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-[200]" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            startOfDay(date) > startOfDay(new Date()) || date < new Date("1900-01-01")
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="make"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Make</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Ford" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Transit" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className={`grid gap-4 ${form.watch("acquisition_type") === "Purchase" ? "grid-cols-3" : "grid-cols-2"}`}>
              <FormField
                control={form.control}
                name="colour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. White" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fuel_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fuel Type <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fuel type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Petrol">Gas</SelectItem>
                        <SelectItem value="Diesel">Diesel</SelectItem>
                        <SelectItem value="Hybrid">Hybrid</SelectItem>
                        <SelectItem value="Electric">Electric</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("acquisition_type") === "Purchase" && (
                <FormField
                  control={form.control}
                  name="purchase_price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Price ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          placeholder="Enter amount"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter vehicle description, special features, condition notes..."
                      className="resize-none min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="acquisition_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Acquisition Type</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      // Clear the opposite field when switching
                      if (value === 'Purchase') {
                        form.setValue('contract_total', undefined);
                        form.trigger('purchase_price');
                      } else {
                        form.setValue('purchase_price', undefined);
                        form.trigger('contract_total');
                      }
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select acquisition type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Purchase">Purchase</SelectItem>
                      <SelectItem value="Finance">Finance</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Rental Rates Section */}
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm">Rental Rates</h3>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-4 items-start">
                <FormField
                  control={form.control}
                  name="daily_rent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="whitespace-nowrap">Daily ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : parseFloat(value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="weekly_rent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="whitespace-nowrap">Weekly ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : parseFloat(value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="monthly_rent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="whitespace-nowrap">Monthly ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : parseFloat(value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="security_deposit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="whitespace-nowrap">Deposit ({currencySymbol})</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Optional"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : parseFloat(value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="allowed_mileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="whitespace-nowrap">Mileage Allowance</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="Unlimited"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : parseInt(value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '.') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="excess_mileage_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="whitespace-nowrap">Excess Mileage Rate</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder={`${currencySymbol} per mile`}
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : parseFloat(value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="available_daily"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel className="text-sm font-medium">Daily Booking</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="available_weekly"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel className="text-sm font-medium">Weekly Booking</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="available_monthly"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel className="text-sm font-medium">Monthly Booking</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Finance Section */}
            {form.watch("acquisition_type") === "Finance" && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Finance Information</h3>
                </div>
                
                <FormField
                  control={form.control}
                  name="contract_total"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Total ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          placeholder="Enter total contract value"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                          onKeyDown={(e) => {
                            if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="text-xs bg-blue-50 text-blue-800 p-3 rounded border border-blue-200">
                  <strong>Finance P&L Approach:</strong> We track total finance cost only (no monthly breakdown). 
                  The full contract value is posted upfront as an Acquisition cost for accurate P&L reporting.
                </div>
              </div>
            )}

            {/* Inspection & Registration Due Dates */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="mot_due_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Inspection Due Date</FormLabel>
                    <Popover modal={true}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick inspection due date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-[200]" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => startOfDay(date) < startOfDay(new Date())}
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
                name="tax_due_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Registration Due Date</FormLabel>
                    <Popover modal={true}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick registration due date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-[200]" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => startOfDay(date) < startOfDay(new Date())}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Compliance Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Compliance</h3>
              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Has Logbook</label>
                  <div className="text-sm text-muted-foreground">
                    Vehicle has a physical logbook
                  </div>
                </div>
                <Switch
                  checked={form.watch("has_logbook")}
                  onCheckedChange={(checked) => form.setValue("has_logbook", checked)}
                />
              </div>
            </div>

            {/* Ownership & Security Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Ownership & Security</h3>
              
              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Service Plan</label>
                  <div className="text-sm text-muted-foreground">
                    Vehicle has an active service plan (for admin visibility only)
                  </div>
                </div>
                <Switch
                  checked={form.watch("has_service_plan")}
                  onCheckedChange={(checked) => form.setValue("has_service_plan", checked)}
                />
              </div>

              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Spare Key</label>
                  <div className="text-sm text-muted-foreground">
                    Spare key exists for this vehicle
                  </div>
                </div>
                <Switch
                  checked={form.watch("has_spare_key")}
                  onCheckedChange={(checked) => {
                    form.setValue("has_spare_key", checked);
                    if (!checked) {
                      form.setValue("spare_key_holder", undefined);
                      form.setValue("spare_key_notes", "");
                    } else {
                      form.setValue("spare_key_holder", "Company");
                    }
                  }}
                />
              </div>

              {form.watch("has_spare_key") && (
                <div className="space-y-4 ml-4 border-l-2 border-muted pl-4">
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Spare Key Holder</label>
                    <RadioGroup
                      value={form.watch("spare_key_holder")}
                      onValueChange={(value) => form.setValue("spare_key_holder", value as "Company" | "Customer")}
                      className="flex flex-col space-y-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="Company" id="edit-company" />
                        <label htmlFor="edit-company" className="text-sm">Company</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="Customer" id="edit-customer" />
                        <label htmlFor="edit-customer" className="text-sm">Customer</label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Notes (Optional)</label>
                    <Textarea
                      placeholder="e.g., with John - locker A3"
                      value={form.watch("spare_key_notes") || ""}
                      onChange={(e) => form.setValue("spare_key_notes", e.target.value)}
                      rows={2}
                    />
                    <div className="text-sm text-muted-foreground">
                      Additional context about the spare key location or holder
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Security Features Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Security Features</h3>

              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">GPS Tracker</label>
                  <div className="text-sm text-muted-foreground">
                    Vehicle has a GPS tracker installed
                  </div>
                </div>
                <Switch
                  checked={form.watch("has_tracker")}
                  onCheckedChange={(checked) => form.setValue("has_tracker", checked)}
                />
              </div>

              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Remote Immobilizer</label>
                  <div className="text-sm text-muted-foreground">
                    Vehicle has a remote immobilizer system
                  </div>
                </div>
                <Switch
                  checked={form.watch("has_remote_immobiliser")}
                  onCheckedChange={(checked) => form.setValue("has_remote_immobiliser", checked)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Security Notes (Optional)</label>
                <Textarea
                  placeholder="Additional security information..."
                  value={form.watch("security_notes") || ""}
                  onChange={(e) => form.setValue("security_notes", e.target.value)}
                  rows={2}
                />
                <div className="text-sm text-muted-foreground">
                  Any additional security-related information or notes
                </div>
              </div>
            </div>


            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
              >
                {loading ? "Updating..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};