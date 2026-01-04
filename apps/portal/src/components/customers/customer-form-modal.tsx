import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Mail, Phone, ChevronDown, ChevronUp, CreditCard, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import { customerFormModalSchema, type CustomerFormModalFormValues } from "@/client-schemas/customers/customer-form-modal";

type CustomerFormData = CustomerFormModalFormValues;

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  customer_type: "Individual" | "Company";
  status: string;
  whatsapp_opt_in: boolean;
  high_switcher?: boolean;
  license_number?: string;
  id_number?: string;
  is_blocked?: boolean;
  blocked_reason?: string;
  nok_full_name?: string;
  nok_relationship?: string;
  nok_phone?: string;
  nok_email?: string;
  nok_address?: string;
}

interface CustomerFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
}

export const CustomerFormModal = ({ open, onOpenChange, customer }: CustomerFormModalProps) => {
  const { tenant } = useTenant();
  const [loading, setLoading] = useState(false);
  const [showNextOfKin, setShowNextOfKin] = useState(false);
  const [blockWarning, setBlockWarning] = useState<{ isBlocked: boolean; reason?: string; type?: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!customer;

  const form = useForm<CustomerFormData>({
    resolver: zodResolver(customerFormModalSchema),
    defaultValues: {
      customer_type: "Individual",
      name: "",
      email: "",
      phone: "",
      license_number: "",
      id_number: "",
      whatsapp_opt_in: false,
      high_switcher: false,
      status: "Active",
      notes: "",
      nok_full_name: "",
      nok_relationship: "",
      nok_phone: "",
      nok_email: "",
      nok_address: "",
    },
  });

  const customerType = form.watch("customer_type");

  // Update form when customer changes
  useEffect(() => {
    setBlockWarning(null);
    if (customer) {
      const hasNextOfKin = customer.nok_full_name || customer.nok_relationship ||
                          customer.nok_phone || customer.nok_email || customer.nok_address;
      setShowNextOfKin(!!hasNextOfKin);

      form.reset({
        customer_type: customer.customer_type || "Individual",
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
        license_number: customer.license_number || "",
        id_number: customer.id_number || "",
        whatsapp_opt_in: customer.whatsapp_opt_in,
        high_switcher: customer.high_switcher || false,
        status: customer.status as "Active" | "Inactive",
        notes: "",
        nok_full_name: customer.nok_full_name || "",
        nok_relationship: customer.nok_relationship || "",
        nok_phone: customer.nok_phone || "",
        nok_email: customer.nok_email || "",
        nok_address: customer.nok_address || "",
      });
    } else {
      setShowNextOfKin(false);
      form.reset({
        customer_type: "Individual",
        name: "",
        email: "",
        phone: "",
        license_number: "",
        id_number: "",
        whatsapp_opt_in: false,
        high_switcher: false,
        status: "Active",
        notes: "",
        nok_full_name: "",
        nok_relationship: "",
        nok_phone: "",
        nok_email: "",
        nok_address: "",
      });
    }
  }, [customer, form]);

  // Check if license or ID is blocked when values change (blocking is only by license, not email)
  const checkBlockedIdentity = async (identityNumber: string) => {
    if (!identityNumber || identityNumber.trim() === '') {
      setBlockWarning(null);
      return;
    }

    const trimmedValue = identityNumber.trim();

    try {
      // First check blocked_identities table (only license and id_card types)
      const { data, error } = await supabase
        .from('blocked_identities')
        .select('identity_type, reason')
        .eq('identity_number', trimmedValue)
        .eq('is_active', true)
        .in('identity_type', ['license', 'id_card', 'passport'])
        .single();

      if (data && !error) {
        setBlockWarning({
          isBlocked: true,
          reason: data.reason,
          type: data.identity_type
        });
        return;
      }

      // Also check if it belongs to a blocked customer directly (only by license/ID, not email)
      const { data: blockedCustomer } = await supabase
        .from('customers')
        .select('name, blocked_reason')
        .eq('is_blocked', true)
        .or(`license_number.eq.${trimmedValue},id_number.eq.${trimmedValue}`)
        .limit(1)
        .single();

      if (blockedCustomer) {
        setBlockWarning({
          isBlocked: true,
          reason: blockedCustomer.blocked_reason || `Belongs to blocked customer: ${blockedCustomer.name}`,
          type: 'license'
        });
        return;
      }

      setBlockWarning(null);
    } catch (err) {
      // No block found
      setBlockWarning(null);
    }
  };

  const onSubmit = async (data: CustomerFormData) => {
    // Block submission if identity is blocked
    if (blockWarning?.isBlocked) {
      toast({
        title: "Blocked Identity",
        description: `This ${blockWarning.type} number is blocked: ${blockWarning.reason}`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Check for duplicate license number (prevent duplicates)
      if (data.license_number) {
        let duplicateQuery = supabase
          .from('customers')
          .select('id, name, license_number')
          .eq('license_number', data.license_number.trim());

        // If editing, exclude current customer from duplicate check
        if (isEditing && customer?.id) {
          duplicateQuery = duplicateQuery.neq('id', customer.id);
        }

        const { data: existingCustomer } = await duplicateQuery.limit(1).single();

        if (existingCustomer) {
          toast({
            title: "Duplicate License Number",
            description: `A customer with this license number already exists: ${existingCustomer.name}`,
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      // Check for duplicate email (prevent duplicates)
      if (data.email) {
        let emailDuplicateQuery = supabase
          .from('customers')
          .select('id, name, email')
          .eq('email', data.email.trim().toLowerCase());

        // If editing, exclude current customer from duplicate check
        if (isEditing && customer?.id) {
          emailDuplicateQuery = emailDuplicateQuery.neq('id', customer.id);
        }

        const { data: existingEmailCustomer } = await emailDuplicateQuery.limit(1).single();

        if (existingEmailCustomer) {
          toast({
            title: "Duplicate Email",
            description: `A customer with this email already exists: ${existingEmailCustomer.name}`,
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      // Check blocking one more time before submission (only license and ID, not email)
      if (!isEditing) {
        const identifiersToCheck = [data.license_number, data.id_number].filter(Boolean);

        // Check blocked_identities table (only license/id types)
        if (identifiersToCheck.length > 0) {
          const { data: blockCheck } = await supabase
            .from('blocked_identities')
            .select('identity_type, reason, identity_number')
            .in('identity_number', identifiersToCheck)
            .eq('is_active', true)
            .in('identity_type', ['license', 'id_card', 'passport'])
            .limit(1)
            .single();

          if (blockCheck) {
            toast({
              title: "Blocked Identity",
              description: `This ${blockCheck.identity_type} number is blocked: ${blockCheck.reason}`,
              variant: "destructive",
            });
            setLoading(false);
            return;
          }
        }

        // Also check if license/id belongs to a blocked customer directly
        // (in case the identity wasn't added to blocked_identities table)
        if (data.license_number || data.id_number) {
          let blockedCustomerQuery = supabase
            .from('customers')
            .select('name, license_number, id_number, blocked_reason')
            .eq('is_blocked', true);

          // Build OR conditions for matching identifiers (only license/ID, not email)
          const orConditions = [];
          if (data.license_number) orConditions.push(`license_number.eq.${data.license_number}`);
          if (data.id_number) orConditions.push(`id_number.eq.${data.id_number}`);

          if (orConditions.length > 0) {
            const { data: blockedCustomer } = await blockedCustomerQuery
              .or(orConditions.join(','))
              .limit(1)
              .single();

            if (blockedCustomer) {
              const matchedField =
                (data.license_number && blockedCustomer.license_number === data.license_number) ? 'license' :
                'ID number';

              toast({
                title: "Blocked Identity",
                description: `This ${matchedField} belongs to a blocked customer (${blockedCustomer.name}): ${blockedCustomer.blocked_reason || 'No reason provided'}`,
                variant: "destructive",
              });
              setLoading(false);
              return;
            }
          }
        }
      }

      const payload: any = {
        customer_type: data.customer_type,
        type: data.customer_type, // Required field in database
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        license_number: data.license_number || null,
        id_number: data.id_number || null,
        whatsapp_opt_in: data.whatsapp_opt_in,
        high_switcher: data.high_switcher,
        status: data.status,
        nok_full_name: data.nok_full_name || null,
        nok_relationship: data.nok_relationship || null,
        nok_phone: data.nok_phone || null,
        nok_email: data.nok_email || null,
        nok_address: data.nok_address || null,
      };

      // Add tenant_id for new customers
      if (!isEditing && tenant?.id) {
        payload.tenant_id = tenant.id;
      }

      if (isEditing) {
        let updateQuery = supabase
          .from("customers")
          .update(payload)
          .eq("id", customer.id);

        if (tenant?.id) {
          updateQuery = updateQuery.eq("tenant_id", tenant.id);
        }

        const { error } = await updateQuery;

        if (error) throw error;

        toast({
          title: "Customer Updated",
          description: `${data.name} has been updated successfully.`,
        });
      } else {
        const { error } = await supabase
          .from("customers")
          .insert(payload);

        if (error) throw error;

        toast({
          title: "Customer Added",
          description: `${data.name} has been added to your customer database.`,
        });
      }

      // Refresh the customers list
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balances-list"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balances-enhanced"] });
      // Also refresh the specific customer detail page if editing
      if (isEditing && customer?.id) {
        queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      }

      // Close modal and reset form
      onOpenChange(false);
      if (!isEditing) {
        form.reset();
      }
    } catch (error) {
      console.error('Error saving customer:', error);
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? 'update' : 'add'} customer. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.handleSubmit(onSubmit)();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {isEditing ? 'Edit Customer' : 'Add New Customer'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="customer_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Type <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <div className="flex gap-6">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            value="Individual"
                            checked={field.value === "Individual"}
                            onChange={() => field.onChange("Individual")}
                            className="w-4 h-4 text-primary"
                          />
                          <span>Individual</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            value="Company"
                            checked={field.value === "Company"}
                            onChange={() => field.onChange("Company")}
                            className="w-4 h-4 text-primary"
                          />
                          <span>Company</span>
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="input-focus">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="high_switcher"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">High Switcher</FormLabel>
                    <div className="text-sm text-muted-foreground">
                      Customer frequently changes cars
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {customerType === "Company" ? "Company Name *" : "Name *"}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={customerType === "Company" ? "Enter company name" : "Enter customer name"}
                      {...field}
                      className="input-focus"
                      autoFocus
                      onChange={(e) => {
                        const value = e.target.value.replace(/\d/g, "");
                        field.onChange(value);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email *
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="email@example.com"
                        {...field}
                        className="input-focus"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      Phone *
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(555) 123-4567"
                        {...field}
                        className="input-focus"
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9\s\-\(\)\+]/g, "");
                          field.onChange(value);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* License and ID Number Fields */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="license_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      Driver's License *
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter license number"
                        {...field}
                        className="input-focus"
                        onBlur={(e) => {
                          field.onBlur();
                          checkBlockedIdentity(e.target.value);
                        }}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Required for identity verification and blocking
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="id_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      ID / Passport Number
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter ID or passport number"
                        {...field}
                        className="input-focus"
                        onBlur={(e) => {
                          field.onBlur();
                          checkBlockedIdentity(e.target.value);
                        }}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      National ID or passport
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Block Warning Alert */}
            {blockWarning?.isBlocked && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Blocked Identity:</strong> This {blockWarning.type} number is blocked.
                  <br />
                  <span className="text-sm">Reason: {blockWarning.reason}</span>
                </AlertDescription>
              </Alert>
            )}


            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Optional notes about this customer..." 
                      {...field}
                      className="input-focus resize-none"
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Next of Kin Section */}
            <Collapsible open={showNextOfKin} onOpenChange={setShowNextOfKin}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" className="w-full">
                  <div className="flex items-center justify-between w-full">
                    <span>Next of Kin / Emergency Contact</span>
                    {showNextOfKin ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="nok_full_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Enter full name"
                              {...field}
                              className="input-focus"
                              onChange={(e) => {
                                const value = e.target.value.replace(/\d/g, "");
                                field.onChange(value);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="nok_relationship"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., Spouse, Parent, Friend"
                              {...field}
                              className="input-focus"
                              onChange={(e) => {
                                const value = e.target.value.replace(/[^a-zA-Z\s]/g, "");
                                field.onChange(value);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="nok_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="(555) 123-4567"
                              {...field}
                              className="input-focus"
                              onChange={(e) => {
                                const value = e.target.value.replace(/[^0-9\s\-\(\)\+]/g, "");
                                field.onChange(value);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="nok_email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="Enter email address" {...field} className="input-focus" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="nok_address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Enter full address..."
                            {...field}
                            className="input-focus resize-none"
                            rows={3}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex justify-end gap-2 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={loading} 
                className="bg-gradient-primary rounded-lg transition-all duration-200 focus:ring-2 focus:ring-primary"
              >
                {loading ? (isEditing ? "Updating..." : "Adding...") : (isEditing ? "Update Customer" : "Add Customer")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};