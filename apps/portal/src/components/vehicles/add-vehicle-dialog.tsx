import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Car, DollarSign, CalendarIcon, ShieldCheck, KeyRound, Cog, Upload, X, Camera } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { FormDescription } from "@/components/ui/form";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { addVehicleDialogSchema, type AddVehicleDialogFormValues } from "@/client-schemas/vehicles/add-vehicle-dialog";
import { getCurrencySymbol } from "@/lib/format-utils";
import { toast as sonnerToast } from "sonner";

type VehicleFormData = AddVehicleDialogFormValues;

interface AddVehicleDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const AddVehicleDialog = ({ open, onOpenChange }: AddVehicleDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'GBP');
  const { logAction } = useAuditLog();

  const form = useForm<VehicleFormData>({
    resolver: zodResolver(addVehicleDialogSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: {
      reg: "",
      vin: "",
      make: "",
      model: "",
      colour: "",
      fuel_type: "Petrol",
      purchase_price: undefined,
      contract_total: undefined,
      acquisition_date: new Date(),
      acquisition_type: "Purchase",
      has_logbook: false,
      has_service_plan: false,
      has_spare_key: false,
      spare_key_holder: undefined,
      spare_key_notes: "",
      has_tracker: false,
      has_remote_immobiliser: false,
      security_notes: "",
      description: "",
      security_deposit: undefined,
      allowed_mileage: undefined,
      excess_mileage_rate: undefined,
    },
  });

  // DEV MODE: Listen for dev panel fill events (only in development)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const handleDevFillVehicle = (e: CustomEvent<{
      reg: string;
      vin?: string;
      make: string;
      model: string;
      year: number;
      colour: string;
      fuel_type: 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric';
      purchase_price?: number;
      daily_rent: number;
      weekly_rent: number;
      monthly_rent: number;
      acquisition_type: 'Purchase' | 'Finance';
      acquisition_date: Date;
      description?: string;
    }>) => {
      const data = e.detail;
      console.log('🔧 DEV MODE: Filling vehicle form with:', data);

      // Set form values
      form.setValue('reg', data.reg);
      if (data.vin) form.setValue('vin', data.vin);
      form.setValue('make', data.make);
      form.setValue('model', data.model);
      form.setValue('year', data.year);
      form.setValue('colour', data.colour);
      form.setValue('fuel_type', data.fuel_type);
      if (data.purchase_price) form.setValue('purchase_price', data.purchase_price);
      form.setValue('daily_rent', data.daily_rent);
      form.setValue('weekly_rent', data.weekly_rent);
      form.setValue('monthly_rent', data.monthly_rent);
      form.setValue('acquisition_type', data.acquisition_type);
      form.setValue('acquisition_date', new Date(data.acquisition_date));
      if (data.description) form.setValue('description', data.description);

      // Trigger form validation
      form.trigger();

      sonnerToast.success('Vehicle form auto-filled by Dev Panel');
    };

    window.addEventListener('dev-fill-vehicle-form', handleDevFillVehicle as EventListener);
    return () => window.removeEventListener('dev-fill-vehicle-form', handleDevFillVehicle as EventListener);
  }, [form]);

  const handleOpenChange = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    } else {
      setIsOpen(newOpen);
    }
  };

  const currentOpen = open !== undefined ? open : isOpen;

  const handlePhotoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newFiles: File[] = [];
    const newPreviews: string[] = [];

    // Process each selected file
    Array.from(files).forEach((file) => {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid File Type",
          description: `${file.name} is not an image file. Please select JPG, PNG, WebP, etc.`,
          variant: "destructive",
        });
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: `${file.name} is larger than 5MB. Please select a smaller image.`,
          variant: "destructive",
        });
        return;
      }

      newFiles.push(file);

      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });

    setPhotoFiles(prev => [...prev, ...newFiles]);
  };

  const handleRemovePhoto = (index: number) => {
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
    if (photoFiles.length === 1 && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onSubmit = async (data: VehicleFormData) => {
    setLoading(true);

    try {
      // Normalize registration
      const normalizedReg = data.reg.toUpperCase().trim();

      const vehicleData: any = {
        reg: normalizedReg,
        vin: data.vin || null,
        make: data.make,
        model: data.model,
        year: data.year,
        colour: data.colour,
        fuel_type: data.fuel_type,
        acquisition_type: data.acquisition_type,
        acquisition_date: format(data.acquisition_date, 'yyyy-MM-dd'),
        daily_rent: data.daily_rent,
        weekly_rent: data.weekly_rent,
        monthly_rent: data.monthly_rent,
        mot_due_date: data.mot_due_date ? format(data.mot_due_date, 'yyyy-MM-dd') : undefined,
        tax_due_date: data.tax_due_date ? format(data.tax_due_date, 'yyyy-MM-dd') : undefined,
        warranty_start_date: data.warranty_start_date ? format(data.warranty_start_date, 'yyyy-MM-dd') : undefined,
        warranty_end_date: data.warranty_end_date ? format(data.warranty_end_date, 'yyyy-MM-dd') : undefined,
        has_logbook: data.has_logbook,
        has_service_plan: data.has_service_plan,
        has_spare_key: data.has_spare_key,
        spare_key_holder: data.has_spare_key ? data.spare_key_holder : null,
        spare_key_notes: data.has_spare_key ? data.spare_key_notes : null,
        has_tracker: data.has_tracker,
        has_remote_immobiliser: data.has_remote_immobiliser,
        security_notes: data.security_notes || null,
        description: data.description || null,
        security_deposit: data.security_deposit || null,
        allowed_mileage: data.allowed_mileage || null,
        excess_mileage_rate: data.excess_mileage_rate || null,
        available_daily: data.available_daily,
        available_weekly: data.available_weekly,
        available_monthly: data.available_monthly,
      };

      // Add type-specific fields
      if (data.acquisition_type === 'Purchase') {
        vehicleData.purchase_price = data.purchase_price;
      } else if (data.acquisition_type === 'Finance') {
        // For finance vehicles, convert contract total to the structure expected by triggers
        vehicleData.initial_payment = data.contract_total;
        vehicleData.monthly_payment = 1; // Dummy value to satisfy constraints
        vehicleData.term_months = 1; // Dummy value
      }

      // Insert vehicle first
      const { data: insertedVehicle, error } = await supabase
        .from("vehicles")
        .insert({
          ...vehicleData,
          tenant_id: tenant?.id || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Audit log for vehicle creation
      if (insertedVehicle?.id) {
        logAction({
          action: "vehicle_created",
          entityType: "vehicle",
          entityId: insertedVehicle.id,
          details: { reg: normalizedReg, make: data.make, model: data.model }
        });
      }

      // Upload photos if any were selected
      if (photoFiles.length > 0 && insertedVehicle) {
        try {
          let uploadedCount = 0;

          for (let i = 0; i < photoFiles.length; i++) {
            const photoFile = photoFiles[i];
            const fileExt = photoFile.name.split('.').pop();
            const fileName = `${insertedVehicle.id}-${Date.now()}-${i}.${fileExt}`;
            const filePath = `${fileName}`;

            // Upload to storage
            const { error: uploadError } = await supabase.storage
              .from('vehicle-photos')
              .upload(filePath, photoFile);

            if (uploadError) {
              console.error(`Photo ${i + 1} upload error:`, uploadError);
              continue;
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
              .from('vehicle-photos')
              .getPublicUrl(filePath);

            // Insert into vehicle_photos table
            const { error: insertError } = await supabase
              .from('vehicle_photos')
              .insert({
                vehicle_id: insertedVehicle.id,
                photo_url: publicUrl,
                display_order: i,
                tenant_id: tenant?.id || null,
              });

            if (insertError) {
              console.error(`Photo ${i + 1} DB insert error:`, insertError);
              // Try to delete the uploaded file if DB insert fails
              await supabase.storage.from('vehicle-photos').remove([filePath]);
              continue;
            }

            uploadedCount++;
          }

          if (uploadedCount === 0) {
            toast({
              title: "Photo Upload Warning",
              description: "Vehicle added but photo uploads failed. You can upload photos later from the vehicle details page.",
              variant: "default",
            });
          } else if (uploadedCount < photoFiles.length) {
            toast({
              title: "Partial Photo Upload",
              description: `Vehicle added with ${uploadedCount} of ${photoFiles.length} photos. Some uploads failed.`,
              variant: "default",
            });
          }
        } catch (photoError: any) {
          console.error('Photo upload error:', photoError);
          toast({
            title: "Photo Upload Warning",
            description: "Vehicle added but photo upload failed. You can upload photos later from the vehicle details page.",
            variant: "default",
          });
        }
      }

      toast({
        title: "Vehicle Added",
        description: `${data.make} ${data.model} (${normalizedReg}) has been added to the fleet.`,
      });

      // Create reminders directly for Inspection/Registration dates if set
      if (insertedVehicle) {
        const today = format(new Date(), 'yyyy-MM-dd');

        // Create Inspection reminder if mot_due_date is set
        if (data.mot_due_date) {
          try {
            const motDate = new Date(data.mot_due_date);
            const daysUntilDue = Math.ceil((motDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

            let ruleCode: string;
            if (daysUntilDue <= 0) ruleCode = 'MOT_0D';
            else if (daysUntilDue <= 7) ruleCode = 'MOT_7D';
            else if (daysUntilDue <= 14) ruleCode = 'MOT_14D';
            else ruleCode = 'MOT_30D';

            const severity = daysUntilDue <= 0 ? 'critical' : daysUntilDue <= 7 ? 'warning' : 'info';
            const dueDateStr = format(data.mot_due_date, 'yyyy-MM-dd');

            await supabase.from('reminders').insert({
              rule_code: ruleCode,
              object_type: 'Vehicle',
              object_id: insertedVehicle.id,
              title: `Inspection due soon — ${normalizedReg} (${daysUntilDue > 0 ? daysUntilDue + ' days' : 'overdue'})`,
              message: `Inspection for ${normalizedReg} (${data.make} ${data.model}) due on ${dueDateStr}. Please schedule inspection.`,
              due_on: dueDateStr,
              remind_on: today,
              severity: severity,
              context: {
                vehicle_id: insertedVehicle.id,
                reg: normalizedReg,
                make: data.make,
                model: data.model,
                due_date: dueDateStr,
                days_until: Math.max(0, daysUntilDue)
              },
              status: 'pending',
              tenant_id: tenant?.id || null
            });
            console.log('Created Inspection reminder for', normalizedReg);
          } catch (reminderError) {
            console.error('Error creating Inspection reminder:', reminderError);
          }
        }

        // Create Registration reminder if tax_due_date is set
        if (data.tax_due_date) {
          try {
            const taxDate = new Date(data.tax_due_date);
            const daysUntilDue = Math.ceil((taxDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

            let ruleCode: string;
            if (daysUntilDue <= 0) ruleCode = 'TAX_0D';
            else if (daysUntilDue <= 7) ruleCode = 'TAX_7D';
            else if (daysUntilDue <= 14) ruleCode = 'TAX_14D';
            else ruleCode = 'TAX_30D';

            const severity = daysUntilDue <= 0 ? 'critical' : daysUntilDue <= 7 ? 'warning' : 'info';
            const dueDateStr = format(data.tax_due_date, 'yyyy-MM-dd');

            await supabase.from('reminders').insert({
              rule_code: ruleCode,
              object_type: 'Vehicle',
              object_id: insertedVehicle.id,
              title: `Registration due soon — ${normalizedReg} (${daysUntilDue > 0 ? daysUntilDue + ' days' : 'overdue'})`,
              message: `Registration for ${normalizedReg} (${data.make} ${data.model}) due on ${dueDateStr}. Please renew.`,
              due_on: dueDateStr,
              remind_on: today,
              severity: severity,
              context: {
                vehicle_id: insertedVehicle.id,
                reg: normalizedReg,
                make: data.make,
                model: data.model,
                due_date: dueDateStr,
                days_until: Math.max(0, daysUntilDue)
              },
              status: 'pending',
              tenant_id: tenant?.id || null
            });
            console.log('Created Registration reminder for', normalizedReg);
          } catch (reminderError) {
            console.error('Error creating Registration reminder:', reminderError);
          }
        }

        // Invalidate reminders cache so the new reminders show up
        queryClient.invalidateQueries({ queryKey: ["reminders"] });
        queryClient.invalidateQueries({ queryKey: ["reminder-stats"] });
      }

      form.reset();
      setPhotoFiles([]);
      setPhotoPreviews([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      handleOpenChange(false);

      // Refresh the vehicles list and P&L data
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-pl"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-count"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-pl-entries"] });
    } catch (error: any) {
      let errorMessage = "Failed to add vehicle. Please try again.";

      // Check for unique constraint violation on registration number
      if (error?.code === '23505' && error?.details?.includes('vehicles_reg_key')) {
        errorMessage = `A vehicle with registration '${data.reg}' already exists. Please use a different registration number.`;
      } else if (error?.code === '23505') {
        errorMessage = "This vehicle registration number is already in use. Please check and try again.";
      } else if (error?.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isControlled = open !== undefined;

  return (
    <Dialog open={currentOpen} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button className="bg-gradient-primary text-primary-foreground hover:opacity-90 transition-all duration-200 rounded-lg focus:ring-2 focus:ring-primary whitespace-nowrap">
            <Plus className="mr-1 sm:mr-2 h-4 w-4 flex-shrink-0" />
            <span className="hidden sm:inline">Add Vehicle</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[750px] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Car className="h-4 w-4 text-primary" />
            Add New Vehicle
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => {
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

            // Require at least one photo
            if (photoFiles.length === 0) {
              toast({
                title: "Photo Required",
                description: "Please upload at least one vehicle photo.",
                variant: "destructive",
              });
              hasErrors = true;
            }

            if (hasErrors) return;

            onSubmit(data);
          })} className="flex flex-col flex-1 overflow-hidden">
            <ScrollArea className="h-[60vh] px-2">
              <div className="space-y-3 px-2 py-1">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="reg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Plate Number <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. AB12 CDE" {...field} />
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
                        <FormLabel>VIN Number</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 1HGBH41JXMN109186" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                                  <span>Pick a date</span>
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

                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name="make"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Make <span className="text-red-500">*</span></FormLabel>
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
                        <FormLabel>Model <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Transit" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="year"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Year <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="e.g. 2020"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseInt(value));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === '.' || e.key === ',') {
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

                <div className={`grid gap-3 ${form.watch("acquisition_type") === "Purchase" ? "grid-cols-3" : "grid-cols-2"}`}>
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
                              placeholder="Enter amount"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                field.onChange(val === '' ? undefined : parseFloat(val));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === '.' || e.key === ',') {
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

                <div className="">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Enter vehicle description, special features, condition notes..."
                            className="resize-none min-h-[60px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-start">
                  <FormField
                    control={form.control}
                    name="daily_rent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="whitespace-nowrap">Daily ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Daily rate"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseInt(value));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === '.' || e.key === ',') {
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
                            min="0"
                            placeholder="Weekly rate"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseInt(value));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === '.' || e.key === ',') {
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
                            min="0"
                            placeholder="Monthly rate"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseInt(value));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === '.' || e.key === ',') {
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
                            min="0"
                            placeholder="Optional"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseFloat(value));
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
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseInt(value));
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
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? undefined : parseFloat(value));
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

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="mot_due_date"
                    render={({ field }) => (
                      <FormItem>
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
                      <FormItem>
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

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="warranty_start_date"
                    render={({ field }) => {
                      const warrantyEndDate = form.watch("warranty_end_date");
                      return (
                        <FormItem>
                          <FormLabel>Warranty Start Date</FormLabel>
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
                                    <span>Pick warranty start date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 z-[200]" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={(date) => {
                                  field.onChange(date);
                                  // Clear end date if the new start date is on or after it
                                  if (date && warrantyEndDate && startOfDay(date) >= startOfDay(warrantyEndDate)) {
                                    form.setValue("warranty_end_date", undefined);
                                  }
                                }}
                                disabled={(date) => date < new Date("1900-01-01")}
                                initialFocus
                                className="pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />

                  <FormField
                    control={form.control}
                    name="warranty_end_date"
                    render={({ field }) => {
                      const warrantyStartDate = form.watch("warranty_start_date");
                      return (
                        <FormItem>
                          <FormLabel>Warranty End Date</FormLabel>
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
                                    <span>Pick warranty end date</span>
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
                                disabled={(date) => {
                                  // Must be after warranty start date if set
                                  if (warrantyStartDate && startOfDay(date) <= startOfDay(warrantyStartDate)) {
                                    return true;
                                  }
                                  return date < new Date("1900-01-01");
                                }}
                                initialFocus
                                className="pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </div>

                <div className="">
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
                </div>

                {/* Contract Total field - only show for Finance */}
                {form.watch("acquisition_type") === "Finance" && (
                  <div className="">
                    <FormField
                      control={form.control}
                      name="contract_total"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contract Total ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="Enter contract total"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                field.onChange(val === '' ? undefined : parseFloat(val));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === '.' || e.key === ',') {
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
                )}

                {/* Vehicle Photo Upload Section */}
                <div className="space-y-2 ">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Camera className="h-5 w-5 text-primary" />
                    Vehicle Photo <span className="text-red-500">*</span>
                  </h3>

                  {/* Photo previews grid */}
                  {photoPreviews.length > 0 ? (
                    <div className="grid grid-cols-3 gap-3">
                      {photoPreviews.map((preview, index) => (
                        <div key={index} className="relative w-full aspect-[4/3] bg-muted/30 rounded-lg border-2 border-muted-foreground/20 overflow-hidden">
                          <img
                            src={preview}
                            alt={`Vehicle preview ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="absolute top-1 right-1 h-6 w-6 p-0"
                            onClick={() => handleRemovePhoto(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex justify-center">
                      <div className="relative w-64 h-48 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20 overflow-hidden">
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                          <Car className="h-12 w-12 mb-2 opacity-30" />
                          <p className="text-xs font-medium">No photo selected</p>
                          <p className="text-xs opacity-75">Upload at least one photo (required)</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <Upload className="h-3 w-3" />
                      {photoPreviews.length > 0 ? 'Add More Photos' : 'Upload Photos'}
                    </Button>
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />

                  {/* Upload instructions */}
                  <div className="text-xs text-muted-foreground/75 text-center">
                    <p>JPG, PNG, WebP • Max 5MB per photo • Multiple selection supported</p>
                  </div>
                </div>

                {/* Compliance Section */}
                <div className="space-y-2 ">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Compliance
                  </h3>

                  <FormField
                    control={form.control}
                    name="has_logbook"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Has Logbook</FormLabel>
                          <div className="text-sm text-muted-foreground">
                            Vehicle has a physical logbook
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="has_service_plan"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Has Service Plan</FormLabel>
                          <div className="text-sm text-muted-foreground">
                            Vehicle has an active service plan
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="has_spare_key"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Has Spare Key</FormLabel>
                          <div className="text-sm text-muted-foreground">
                            Vehicle has a spare key available
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* Spare Key Holder - only show if has_spare_key is true */}
                  {form.watch("has_spare_key") && (
                    <div className="">
                      <FormField
                        control={form.control}
                        name="spare_key_holder"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Spare Key Holder</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select who holds the spare key" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Company">Company</SelectItem>
                                <SelectItem value="Customer">Customer</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  {/* Spare Key Notes - only show if has_spare_key is true */}
                  {form.watch("has_spare_key") && (
                    <div className="">
                      <FormField
                        control={form.control}
                        name="spare_key_notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Spare Key Notes</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Additional notes about spare key location or details..."
                                className="resize-none"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>

                {/* Security Section */}
                <div className="space-y-2 ">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" />
                    Security Features
                  </h3>

                  <FormField
                    control={form.control}
                    name="has_tracker"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Has Tracker</FormLabel>
                          <div className="text-sm text-muted-foreground">
                            Vehicle has a GPS tracker installed
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="has_remote_immobiliser"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-2">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Has Remote Immobilizer</FormLabel>
                          <div className="text-sm text-muted-foreground">
                            Vehicle has a remote immobilizer system
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="security_notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Security Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Additional security information..."
                            className="resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 px-4 py-2 border-t flex-shrink-0">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-gradient-primary rounded-lg transition-all duration-200 focus:ring-2 focus:ring-primary"
              >
                {loading ? "Adding..." : "Add Vehicle"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};