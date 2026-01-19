'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Settings as SettingsIcon, Building2, Bell, Zap, Upload, Save, Loader2, Database, AlertTriangle, Trash2, CreditCard, Palette, Link2, CheckCircle2, AlertCircle, ExternalLink, MapPin, FileText, Car, Mail, ShieldX, FilePenLine, Receipt, Banknote, Shield, Copy, Check, Clock } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { useRentalSettings } from '@/hooks/use-rental-settings';
import { LogoUploadWithResize } from '@/components/settings/logo-upload-with-resize';
import { FaviconUpload } from '@/components/settings/favicon-upload';
import { DataCleanupDialog } from '@/components/settings/data-cleanup-dialog';
import ReminderRulesConfig from '@/components/settings/reminder-rules-config';
import { ColorPicker } from '@/components/settings/color-picker';
import { Textarea } from '@/components/ui/textarea';
import { OGImageUpload } from '@/components/settings/og-image-upload';
import { StripeConnectSettings } from '@/components/settings/stripe-connect-settings';
import { LocationSettings } from '@/components/settings/location-settings';
import { getTimezonesByRegion, findTimezone } from '@/lib/timezones';

const Settings = () => {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('reminders');
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [showDataCleanupDialog, setShowDataCleanupDialog] = useState(false);

  // Use the new centralized settings hook - must be before useEffects that depend on it
  const {
    settings,
    isLoading,
    error,
    updateCompanyProfile,
    toggleReminder,
    setPaymentMode,
    setBookingPaymentMode,
    updateBranding: updateOrgBranding,
    isUpdating
  } = useOrgSettings();

  // Get tenant context for ID
  const { tenant } = useTenant();

  // Use tenant branding hook for multi-tenant branding updates
  const {
    branding: tenantBranding,
    updateBranding: updateTenantBranding,
    isUpdating: isUpdatingTenantBranding
  } = useTenantBranding();

  // Use rental settings hook for rental configuration
  const {
    settings: rentalSettings,
    updateSettings: updateRentalSettings,
    isUpdating: isUpdatingRentalSettings
  } = useRentalSettings();

  // Rental settings form state
  const [rentalForm, setRentalForm] = useState({
    minimum_rental_age: 18,
    tax_enabled: false,
    tax_percentage: 0,
    service_fee_enabled: false,
    service_fee_amount: 0,
    service_fee_type: 'fixed_amount' as 'percentage' | 'fixed_amount',
    service_fee_value: 0,
    deposit_mode: 'global' as 'global' | 'per_vehicle',
    global_deposit_amount: 0,
    // Working hours settings
    working_hours_always_open: false,
    working_hours_open: '09:00',
    working_hours_close: '17:00',
    timezone: 'America/Chicago',
  });

  // Sync rental form with loaded settings
  useEffect(() => {
    if (rentalSettings) {
      setRentalForm({
        minimum_rental_age: rentalSettings.minimum_rental_age ?? 18,
        tax_enabled: rentalSettings.tax_enabled ?? false,
        tax_percentage: rentalSettings.tax_percentage ?? 0,
        service_fee_enabled: rentalSettings.service_fee_enabled ?? false,
        service_fee_amount: rentalSettings.service_fee_amount ?? 0,
        service_fee_type: (rentalSettings.service_fee_type as 'percentage' | 'fixed_amount') ?? 'fixed_amount',
        service_fee_value: rentalSettings.service_fee_value ?? rentalSettings.service_fee_amount ?? 0,
        deposit_mode: rentalSettings.deposit_mode ?? 'global',
        global_deposit_amount: rentalSettings.global_deposit_amount ?? 0,
        // Working hours settings
        working_hours_always_open: rentalSettings.working_hours_always_open ?? false,
        working_hours_open: rentalSettings.working_hours_open ?? '09:00',
        working_hours_close: rentalSettings.working_hours_close ?? '17:00',
        timezone: tenant?.timezone ?? 'America/Chicago',
      });
    }
  }, [rentalSettings, tenant?.timezone]);

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['branding', 'reminders', 'payments', 'stripe-connect', 'locations', 'agreement', 'rental', 'blacklist'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Branding form state
  const [brandingForm, setBrandingForm] = useState({
    app_name: '',
    primary_color: '#C6A256',
    secondary_color: '#C6A256',
    accent_color: '#C6A256',
    light_primary_color: '',
    light_secondary_color: '',
    light_accent_color: '',
    dark_primary_color: '',
    dark_secondary_color: '',
    dark_accent_color: '',
    light_background_color: '',
    dark_background_color: '',
    light_header_footer_color: '',
    dark_header_footer_color: '',
    meta_title: '',
    meta_description: '',
    og_image_url: '',
    favicon_url: '',
  });
  const [isSavingBranding, setIsSavingBranding] = useState(false);

  // Sync form with tenant branding ONLY (not org_settings to avoid cross-tenant data leakage)
  useEffect(() => {
    // Only use tenantBranding - org_settings is not tenant-aware for branding
    const b = tenantBranding;
    if (!b) return; // Wait for tenant branding to load

    setBrandingForm({
      app_name: b.app_name || 'Drive 917',
      primary_color: b.primary_color || '#C6A256',
      secondary_color: b.secondary_color || '#C6A256',
      accent_color: b.accent_color || '#C6A256',
      light_primary_color: b.light_primary_color || '',
      light_secondary_color: b.light_secondary_color || '',
      light_accent_color: b.light_accent_color || '',
      dark_primary_color: b.dark_primary_color || '',
      dark_secondary_color: b.dark_secondary_color || '',
      dark_accent_color: b.dark_accent_color || '',
      light_background_color: b.light_background_color || '',
      dark_background_color: b.dark_background_color || '',
      light_header_footer_color: b.light_header_footer_color || '',
      dark_header_footer_color: b.dark_header_footer_color || '',
      meta_title: b.meta_title || '',
      meta_description: b.meta_description || '',
      og_image_url: b.og_image_url || '',
      favicon_url: b.favicon_url || '',
    });
  }, [tenantBranding]);

  // Helper to reset form to current tenant branding
  const resetBrandingForm = () => {
    const b = tenantBranding;
    if (!b) return;

    setBrandingForm({
      app_name: b.app_name || 'Drive 917',
      primary_color: b.primary_color || '#C6A256',
      secondary_color: b.secondary_color || '#C6A256',
      accent_color: b.accent_color || '#C6A256',
      light_primary_color: b.light_primary_color || '',
      light_secondary_color: b.light_secondary_color || '',
      light_accent_color: b.light_accent_color || '',
      dark_primary_color: b.dark_primary_color || '',
      dark_secondary_color: b.dark_secondary_color || '',
      dark_accent_color: b.dark_accent_color || '',
      light_background_color: b.light_background_color || '',
      dark_background_color: b.dark_background_color || '',
      light_header_footer_color: b.light_header_footer_color || '',
      dark_header_footer_color: b.dark_header_footer_color || '',
      meta_title: b.meta_title || '',
      meta_description: b.meta_description || '',
      og_image_url: b.og_image_url || '',
      favicon_url: b.favicon_url || '',
    });
  };

  // Maintenance run tracking
  const { data: maintenanceRuns } = useQuery({
    queryKey: ['maintenance-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
  });

  // Promo Code State
  const [promoForm, setPromoForm] = useState({
    name: '',
    code: '',
    promo_id: 1,
    type: 'percentage',
    value: '',
    created_at: new Date(),
    expires_at: new Date(new Date().setMonth(new Date().getMonth() + 1)),
    max_users: '',
  });

  // Fetch Promo Codes (moved up for use in generator)
  const { data: promoCodes, isLoading: isLoadingPromos, refetch: refetchPromos } = useQuery({
    queryKey: ['promocodes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promocodes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching promocodes:', error);
        return [];
      }
      return data || [];
    },
  });

  // Generate promo code based on new logic: {promo_id}{name_3chars}{value}
  const generatePromoCode = useCallback(() => {
    if (!promoForm.name || !promoForm.value) return;

    // 1. Get first 3 chars of name (or less)
    const namePart = promoForm.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const valPart = promoForm.value; // Percentage or value amount

    // 2. Loop to find unique ID
    let currentId = 1;
    let uniqueCode = '';

    // Create a set of existing codes for fast lookup
    const existingCodes = new Set(promoCodes?.map((p: any) => p.code) || []);

    while (true) {
      // Logic: {promo_id}{namePart}{valPart}
      // Example: 1SUM10, 2SUM10, etc.
      const candidateCode = `${currentId}${namePart}${valPart}`;

      if (!existingCodes.has(candidateCode)) {
        uniqueCode = candidateCode;
        break;
      }
      currentId++;
      // Safety break to prevent infinite loops (unlikely but good practice)
      if (currentId > 10000) break;
    }

    setPromoForm(prev => ({
      ...prev,
      code: uniqueCode,
      promo_id: currentId
    }));
  }, [promoForm.name, promoForm.value, promoCodes]);

  // Auto-generate code when relevant fields change
  useEffect(() => {
    generatePromoCode();
  }, [promoForm.name, promoForm.value, promoCodes, generatePromoCode]);

  // Create Promo Code Mutation
  const createPromoMutation = useMutation({
    mutationFn: async (newPromo: typeof promoForm) => {
      if (!tenant?.id) throw new Error('Tenant ID not found');

      const { data, error } = await supabase
        .from('promocodes')
        .insert({
          name: newPromo.name,
          code: newPromo.code,
          promo_id: newPromo.promo_id,
          type: newPromo.type,
          value: parseFloat(newPromo.value),
          created_at: format(newPromo.created_at, 'yyyy-MM-dd'),
          expires_at: format(newPromo.expires_at, 'yyyy-MM-dd'),
          max_users: parseInt(newPromo.max_users) || 1,
          tenant_id: tenant.id
        })
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Promo code created successfully",
      });
      // Reset form
      setPromoForm({
        name: '',
        code: '',
        promo_id: 1, // Reset logic handled by generator anyway
        type: 'percentage',
        value: '',
        created_at: new Date(),
        expires_at: new Date(new Date().setMonth(new Date().getMonth() + 1)),
        max_users: '',
      });
      // generatePromoCode(); // useEffect will trigger this
      refetchPromos();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create promo code",
        variant: "destructive",
      });
    },
  });

  const handleCreatePromo = () => {
    if (!promoForm.name || !promoForm.value || !promoForm.max_users) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createPromoMutation.mutate(promoForm);
  };

  // Edit & Delete State
  const [editingPromo, setEditingPromo] = useState<any>(null);
  const [deletingPromo, setDeletingPromo] = useState<any>(null);

  // Regenerate Code on Edit
  const regenerateEditCode = useCallback(() => {
    if (!editingPromo?.name || !editingPromo?.value) return;

    // Use same generator logic
    const namePart = editingPromo.name.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const valPart = editingPromo.value;

    // Existing codes WITHOUT the current one (normally we'd exclude current ID, but logic below finds new slot anyway)
    // Actually, we must exclude the current promo's *original* code from the "taken" list if we want to allow it to keep its spot 
    // IF the code hasn't changed pattern. But here we assume pattern matches.
    // Simpler: Just check all other promos.
    const otherPromos = promoCodes?.filter((p: any) => p.id !== editingPromo.id) || [];
    const existingCodes = new Set(otherPromos.map((p: any) => p.code));

    let currentId = 1;
    let uniqueCode = '';

    while (true) {
      const candidateCode = `${currentId}${namePart}${valPart}`;
      if (!existingCodes.has(candidateCode)) {
        uniqueCode = candidateCode;
        break;
      }
      currentId++;
      if (currentId > 10000) break;
    }

    // Only update if changed prevents infinite loops and unnecessary renders
    if (editingPromo.code !== uniqueCode || editingPromo.promo_id !== currentId) {
      setEditingPromo((prev: any) => ({
        ...prev,
        code: uniqueCode,
        promo_id: currentId
      }));
    }
  }, [editingPromo?.name, editingPromo?.value, promoCodes, editingPromo?.id]);

  // Effect to trigger regeneration on edit field changes
  useEffect(() => {
    if (editingPromo) {
      // Debounce or just check strict equality? 
      // We need to avoid infinite loop where setEditingPromo triggers this effect again.
      // The dependency array includes name/value. setEditingPromo updates code/id, so safe.
      regenerateEditCode();
    }
  }, [editingPromo?.name, editingPromo?.value, regenerateEditCode]);

  // Update Promo Mutation
  const updatePromoMutation = useMutation({
    mutationFn: async (updatedPromo: any) => {
      if (!tenant?.id) throw new Error('Tenant ID not found');

      const { data, error } = await supabase
        .from('promocodes')
        .update({
          name: updatedPromo.name,
          code: updatedPromo.code,         // Update code
          promo_id: updatedPromo.promo_id, // Update promo_id
          type: updatedPromo.type,
          value: parseFloat(updatedPromo.value),
          expires_at: format(new Date(updatedPromo.expires_at), 'yyyy-MM-dd'),
          max_users: parseInt(updatedPromo.max_users) || 1
        })
        .eq('id', updatedPromo.id)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Promo code updated successfully",
      });
      setEditingPromo(null);
      refetchPromos();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update promo code",
        variant: "destructive",
      });
    },
  });

  // Delete Promo Mutation
  const deletePromoMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!tenant?.id) throw new Error('Tenant ID not found');

      const { error } = await supabase
        .from('promocodes')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Promo code deleted successfully",
      });
      setDeletingPromo(null);
      refetchPromos();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete promo code",
        variant: "destructive",
      });
    },
  });

  const handleUpdatePromo = () => {
    if (!editingPromo.name || !editingPromo.value || !editingPromo.max_users) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    updatePromoMutation.mutate(editingPromo);
  };

  const handleCompanyProfileSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const profile = {
      company_name: formData.get('company_name') as string,
      timezone: formData.get('timezone') as string,
      currency_code: formData.get('currency') as string,
      date_format: formData.get('date_format') as string,
      logo_url: settings?.logo_url || undefined,
    };

    updateCompanyProfile(profile);
  };

  const handleSaveBranding = async () => {
    setIsSavingBranding(true);
    try {
      // Prepare the data - keep actual color values, convert empty to null
      const brandingData = {
        app_name: brandingForm.app_name,
        primary_color: brandingForm.primary_color,
        secondary_color: brandingForm.secondary_color,
        accent_color: brandingForm.accent_color,
        light_primary_color: brandingForm.light_primary_color || null,
        light_secondary_color: brandingForm.light_secondary_color || null,
        light_accent_color: brandingForm.light_accent_color || null,
        dark_primary_color: brandingForm.dark_primary_color || null,
        dark_secondary_color: brandingForm.dark_secondary_color || null,
        dark_accent_color: brandingForm.dark_accent_color || null,
        light_background_color: brandingForm.light_background_color || null,
        dark_background_color: brandingForm.dark_background_color || null,
        light_header_footer_color: brandingForm.light_header_footer_color || null,
        dark_header_footer_color: brandingForm.dark_header_footer_color || null,
        meta_title: brandingForm.meta_title,
        meta_description: brandingForm.meta_description,
        og_image_url: brandingForm.og_image_url,
        favicon_url: brandingForm.favicon_url || null,
        logo_url: tenantBranding?.logo_url || null,
      };

      console.log('Saving branding data:', brandingData);

      // Update tenant branding (multi-tenant aware - updates tenants table)
      // This is what useDynamicTheme reads from
      await updateTenantBranding(brandingData);

      // Also update org settings for backward compatibility
      await updateOrgBranding(brandingData);

      toast({
        title: "Branding Updated",
        description: "Your branding settings have been saved and applied.",
      });

      // No reload needed - useDynamicTheme will pick up changes from the query cache
    } catch (error: any) {
      console.error('Branding save error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save branding settings",
        variant: "destructive",
      });
    } finally {
      setIsSavingBranding(false);
    }
  };

  const handleBackfillPayments = async () => {
    setIsBackfilling(true);
    try {
      // Record maintenance run start
      const { data: runRecord, error: insertError } = await supabase
        .from('maintenance_runs')
        .insert({
          operation_type: 'payment_reapplication',
          status: 'running',
          started_by: 'settings_manual'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const startTime = Date.now();
      const { data, error } = await supabase.rpc("reapply_all_payments_v2");
      const duration = Math.floor((Date.now() - startTime) / 1000);

      if (error) {
        // Update run record with error
        await supabase
          .from('maintenance_runs')
          .update({
            status: 'failed',
            error_message: error.message,
            duration_seconds: duration,
            completed_at: new Date().toISOString()
          })
          .eq('id', runRecord.id);

        throw error;
      }

      // Update run record with success
      await supabase
        .from('maintenance_runs')
        .update({
          status: 'completed',
          payments_processed: data[0]?.payments_processed || 0,
          customers_affected: data[0]?.customers_affected || 0,
          revenue_recalculated: data[0]?.total_credit_applied || 0,
          duration_seconds: duration,
          completed_at: new Date().toISOString()
        })
        .eq('id', runRecord.id);

      toast({
        title: "Maintenance Complete",
        description: `Processed ${data[0]?.payments_processed || 0} payments, affected ${data[0]?.customers_affected || 0} customers, applied $${data[0]?.total_credit_applied?.toFixed(2) || '0.00'} in credit. Duration: ${duration}s`,
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-runs"] });

    } catch (error: any) {
      console.error("Backfill error:", error);
      toast({
        title: "Maintenance Failed",
        description: `Failed to reapply payments: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setIsBackfilling(false);
    }
  };

  // Show error state with fallback
  if (error && !settings) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-foreground">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Configure your fleet management system
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <div>
                <h3 className="font-medium">Failed to load settings</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {error.message || 'Unable to connect to settings service'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => window.location.reload()}
                >
                  Reload Page
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading && !settings) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-foreground">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Configure your fleet management system
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading settings...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Configure your fleet management system
          </p>
        </div>
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-9">
          <TabsTrigger value="branding" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Branding</span>
          </TabsTrigger>
          <TabsTrigger value="reminders" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Reminders</span>
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden sm:inline">Payments</span>
          </TabsTrigger>
          <TabsTrigger value="stripe-connect" className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            <span className="hidden sm:inline">Stripe Connect</span>
          </TabsTrigger>
          <TabsTrigger value="locations" className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span className="hidden sm:inline">Locations</span>
          </TabsTrigger>
          <TabsTrigger value="rental" className="flex items-center gap-2">
            <Car className="h-4 w-4" />
            <span className="hidden sm:inline">Bookings</span>
          </TabsTrigger>
          <TabsTrigger value="agreement" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Agreement</span>
          </TabsTrigger>
          <TabsTrigger value="emails" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Emails</span>
          </TabsTrigger>
          <TabsTrigger value="blacklist" className="flex items-center gap-2">
            <ShieldX className="h-4 w-4" />
            <span className="hidden sm:inline">Blacklist</span>
          </TabsTrigger>
        </TabsList>

        {/* Branding Tab */}
        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-primary" />
                Brand Identity
              </CardTitle>
              <CardDescription>
                Customize your portal's appearance and branding
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* App Name */}
              <div className="space-y-2">
                <Label htmlFor="app_name">Application Name</Label>
                <Input
                  id="app_name"
                  value={brandingForm.app_name}
                  onChange={(e) => setBrandingForm(prev => ({ ...prev, app_name: e.target.value }))}
                  placeholder="My Fleet Portal"
                />
                <p className="text-xs text-muted-foreground">
                  This name appears in the sidebar and browser title
                </p>
              </div>

              {/* Logo Upload */}
              <div className="space-y-2">
                <LogoUploadWithResize
                  currentLogoUrl={tenantBranding?.logo_url || undefined}
                  onLogoChange={async (logoUrl) => {
                    // Update tenant branding (primary source for multi-tenant)
                    await updateTenantBranding({ logo_url: logoUrl || '' });
                    // Also update org settings for backward compatibility
                    await updateOrgBranding({ logo_url: logoUrl || '' });
                  }}
                  label="Company Logo"
                  description="Upload your logo (you can resize before uploading)"
                />
              </div>

              {/* Favicon Upload */}
              <div className="space-y-2">
                <FaviconUpload
                  currentFaviconUrl={brandingForm.favicon_url || undefined}
                  onFaviconChange={(faviconUrl) => {
                    setBrandingForm(prev => ({ ...prev, favicon_url: faviconUrl || '' }));
                  }}
                />
              </div>

              <Separator />

              {/* Color Settings */}
              <div className="space-y-4">
                <h3 className="font-medium">Default Theme Colors</h3>
                <p className="text-sm text-muted-foreground">
                  Base colors used when theme-specific colors are not set.
                </p>

                <div className="grid gap-6 md:grid-cols-3">
                  <ColorPicker
                    label="Primary Color"
                    value={brandingForm.primary_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, primary_color: color }))}
                    description="Main brand color (fallback)"
                  />
                  <ColorPicker
                    label="Secondary Color"
                    value={brandingForm.secondary_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, secondary_color: color }))}
                    description="Secondary color (fallback)"
                  />
                  <ColorPicker
                    label="Accent Color"
                    value={brandingForm.accent_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, accent_color: color }))}
                    description="Accent color (fallback)"
                  />
                </div>
              </div>

              <Separator />

              {/* Light Theme Colors */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Light Theme Colors</h3>
                    <p className="text-sm text-muted-foreground">
                      Colors used when light mode is active. Leave empty to use defaults.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBrandingForm(prev => ({
                      ...prev,
                      light_primary_color: '',
                      light_secondary_color: '',
                      light_accent_color: ''
                    }))}
                  >
                    Clear
                  </Button>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <ColorPicker
                    label="Light Primary"
                    value={brandingForm.light_primary_color || brandingForm.primary_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, light_primary_color: color }))}
                    description="Primary color in light mode"
                  />
                  <ColorPicker
                    label="Light Secondary"
                    value={brandingForm.light_secondary_color || brandingForm.secondary_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, light_secondary_color: color }))}
                    description="Secondary color in light mode"
                  />
                  <ColorPicker
                    label="Light Accent"
                    value={brandingForm.light_accent_color || brandingForm.accent_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, light_accent_color: color }))}
                    description="Accent color in light mode"
                  />
                </div>

                {/* Light Theme Preview */}
                <div className="p-4 border rounded-lg" style={{ backgroundColor: brandingForm.light_background_color || '#F5F3EE' }}>
                  <p className="text-sm font-medium mb-3" style={{ color: '#1A2B25' }}>Light Mode Preview</p>
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <button
                      type="button"
                      style={{ backgroundColor: brandingForm.light_primary_color || brandingForm.primary_color }}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-3 sm:px-4 py-2 text-white hover:opacity-90 transition-opacity"
                    >
                      Primary
                    </button>
                    <button
                      type="button"
                      style={{
                        borderColor: brandingForm.light_secondary_color || brandingForm.secondary_color,
                        color: brandingForm.light_secondary_color || brandingForm.secondary_color,
                        backgroundColor: 'transparent'
                      }}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-3 sm:px-4 py-2 border-2 hover:opacity-90 transition-opacity"
                    >
                      Secondary
                    </button>
                    <span
                      style={{ backgroundColor: brandingForm.light_accent_color || brandingForm.accent_color }}
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                    >
                      Accent
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Dark Theme Colors */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Dark Theme Colors</h3>
                    <p className="text-sm text-muted-foreground">
                      Colors used when dark mode is active. Leave empty to use defaults.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBrandingForm(prev => ({
                      ...prev,
                      dark_primary_color: '',
                      dark_secondary_color: '',
                      dark_accent_color: ''
                    }))}
                  >
                    Clear
                  </Button>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <ColorPicker
                    label="Dark Primary"
                    value={brandingForm.dark_primary_color || brandingForm.primary_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, dark_primary_color: color }))}
                    description="Primary color in dark mode"
                  />
                  <ColorPicker
                    label="Dark Secondary"
                    value={brandingForm.dark_secondary_color || brandingForm.secondary_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, dark_secondary_color: color }))}
                    description="Secondary color in dark mode"
                  />
                  <ColorPicker
                    label="Dark Accent"
                    value={brandingForm.dark_accent_color || brandingForm.accent_color}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, dark_accent_color: color }))}
                    description="Accent color in dark mode"
                  />
                </div>

                {/* Dark Theme Preview */}
                <div className="p-4 border rounded-lg" style={{ backgroundColor: brandingForm.dark_background_color || '#1A2B25' }}>
                  <p className="text-sm font-medium mb-3" style={{ color: '#F5F3EE' }}>Dark Mode Preview</p>
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <button
                      type="button"
                      style={{ backgroundColor: brandingForm.dark_primary_color || brandingForm.primary_color }}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-3 sm:px-4 py-2 text-white hover:opacity-90 transition-opacity"
                    >
                      Primary
                    </button>
                    <button
                      type="button"
                      style={{
                        borderColor: brandingForm.dark_secondary_color || brandingForm.secondary_color,
                        color: brandingForm.dark_secondary_color || brandingForm.secondary_color,
                        backgroundColor: 'transparent'
                      }}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-3 sm:px-4 py-2 border-2 hover:opacity-90 transition-opacity"
                    >
                      Secondary
                    </button>
                    <span
                      style={{ backgroundColor: brandingForm.dark_accent_color || brandingForm.accent_color }}
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                    >
                      Accent
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Background Colors */}
              <div className="space-y-4">
                <h3 className="font-medium">Background Colors</h3>
                <p className="text-sm text-muted-foreground">
                  Customize the background color for light and dark modes. Leave empty to use defaults.
                </p>

                <div className="grid gap-6 md:grid-cols-2">
                  <ColorPicker
                    label="Light Mode Background"
                    value={brandingForm.light_background_color || '#F5F3EE'}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, light_background_color: color }))}
                    description="Background when light theme is active"
                  />
                  <ColorPicker
                    label="Dark Mode Background"
                    value={brandingForm.dark_background_color || '#1A2B25'}
                    onChange={(color) => setBrandingForm(prev => ({ ...prev, dark_background_color: color }))}
                    description="Background when dark theme is active"
                  />
                </div>

                {/* Background Preview */}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div
                    className="p-4 rounded-lg border"
                    style={{ backgroundColor: brandingForm.light_background_color || '#F5F3EE' }}
                  >
                    <p className="text-sm font-medium" style={{ color: '#1A2B25' }}>Light Mode Preview</p>
                    <p className="text-xs mt-1" style={{ color: '#4A5568' }}>This is how content will appear</p>
                  </div>
                  <div
                    className="p-4 rounded-lg border"
                    style={{ backgroundColor: brandingForm.dark_background_color || '#1A2B25' }}
                  >
                    <p className="text-sm font-medium" style={{ color: '#F5F3EE' }}>Dark Mode Preview</p>
                    <p className="text-xs mt-1" style={{ color: '#A0AEC0' }}>This is how content will appear</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBrandingForm(prev => ({
                      ...prev,
                      light_background_color: '',
                      dark_background_color: ''
                    }))}
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Header/Footer Colors */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-primary" />
                Header & Footer Colors
              </CardTitle>
              <CardDescription>
                Customize the navigation header and footer colors for the client website.
                Both default to #1A2B25 (dark forest green) if not set.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-6 md:grid-cols-2">
                <ColorPicker
                  label="Light Theme Header/Footer"
                  value={brandingForm.light_header_footer_color || '#1A2B25'}
                  onChange={(color) => setBrandingForm(prev => ({ ...prev, light_header_footer_color: color }))}
                  description="Header & footer color when light theme is active"
                />
                <ColorPicker
                  label="Dark Theme Header/Footer"
                  value={brandingForm.dark_header_footer_color || '#1A2B25'}
                  onChange={(color) => setBrandingForm(prev => ({ ...prev, dark_header_footer_color: color }))}
                  description="Header & footer color when dark theme is active"
                />
              </div>

              {/* Header/Footer Preview */}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div
                  className="p-4 rounded-lg border"
                  style={{ backgroundColor: brandingForm.light_header_footer_color || '#1A2B25' }}
                >
                  <p className="text-sm font-medium" style={{ color: '#F5F3EE' }}>Light Theme Nav</p>
                  <p className="text-xs mt-1" style={{ color: '#A0AEC0' }}>Header & footer appearance</p>
                </div>
                <div
                  className="p-4 rounded-lg border"
                  style={{ backgroundColor: brandingForm.dark_header_footer_color || '#1A2B25' }}
                >
                  <p className="text-sm font-medium" style={{ color: '#F5F3EE' }}>Dark Theme Nav</p>
                  <p className="text-xs mt-1" style={{ color: '#A0AEC0' }}>Header & footer appearance</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBrandingForm(prev => ({
                    ...prev,
                    light_header_footer_color: '',
                    dark_header_footer_color: ''
                  }))}
                >
                  Reset to Default (#1A2B25)
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* SEO Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-primary" />
                SEO & Meta Tags
              </CardTitle>
              <CardDescription>
                Configure how your portal appears in search engines and social media shares
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="meta_title">Page Title</Label>
                <Input
                  id="meta_title"
                  value={brandingForm.meta_title}
                  onChange={(e) => setBrandingForm(prev => ({ ...prev, meta_title: e.target.value }))}
                  placeholder="My Company - Fleet Portal"
                />
                <p className="text-xs text-muted-foreground">
                  This appears in browser tabs and search results
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meta_description">Meta Description</Label>
                <Textarea
                  id="meta_description"
                  value={brandingForm.meta_description}
                  onChange={(e) => setBrandingForm(prev => ({ ...prev, meta_description: e.target.value }))}
                  placeholder="Manage your fleet efficiently with our comprehensive portal"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  A brief description for search engine results (recommended: 150-160 characters)
                </p>
              </div>

              <div className="space-y-2">
                <Label>Social Share Image (OG Image)</Label>
                <OGImageUpload
                  currentImageUrl={brandingForm.og_image_url || undefined}
                  onImageChange={(imageUrl) => {
                    setBrandingForm(prev => ({ ...prev, og_image_url: imageUrl || '' }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Image shown when sharing on social media (recommended: 1200x630px)
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 w-full sm:w-auto">
                  Reset All to Defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Branding to Defaults?</AlertDialogTitle>
                  <div className="text-sm text-muted-foreground">
                    This will reset all branding settings to their original values:
                    <ul className="mt-2 text-sm list-disc list-inside space-y-1">
                      <li>App Name: "Drive 917"</li>
                      <li>Primary Color: Gold (#C6A256)</li>
                      <li>Secondary & Accent: Gold (#C6A256)</li>
                      <li>Background Colors: Theme defaults</li>
                      <li>SEO settings: Default values</li>
                    </ul>
                  </div>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      setIsSavingBranding(true);
                      try {
                        const defaultBranding = {
                          app_name: 'Drive 917',
                          primary_color: '#C6A256',
                          secondary_color: '#C6A256',
                          accent_color: '#C6A256',
                          light_primary_color: null,
                          light_secondary_color: null,
                          light_accent_color: null,
                          dark_primary_color: null,
                          dark_secondary_color: null,
                          dark_accent_color: null,
                          light_background_color: null,
                          dark_background_color: null,
                          meta_title: 'Drive 917 - Portal',
                          meta_description: 'Fleet management portal',
                          og_image_url: '',
                          favicon_url: null,
                        };
                        // Update tenant branding (for useDynamicTheme)
                        await updateTenantBranding(defaultBranding);
                        // Update org settings for backward compatibility
                        await updateOrgBranding(defaultBranding);
                        toast({
                          title: "Branding Reset",
                          description: "All branding settings have been restored to defaults.",
                        });
                      } catch (error: any) {
                        toast({
                          title: "Error",
                          description: error.message || "Failed to reset branding",
                          variant: "destructive",
                        });
                      } finally {
                        setIsSavingBranding(false);
                      }
                    }}
                  >
                    Reset to Defaults
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              onClick={handleSaveBranding}
              disabled={isSavingBranding}
              className="min-w-[120px] w-full sm:w-auto"
            >
              {isSavingBranding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* Reminders Tab */}
        <TabsContent value="reminders" className="space-y-6">
          {/* Legacy Reminder Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                Basic Reminder Settings
              </CardTitle>
              <CardDescription>
                Simple on/off toggles for payment reminder types
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium">Payment Due Today</h4>
                      <Badge variant="secondary" className="text-xs whitespace-nowrap">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders for payments due today
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_due_today ?? true}
                    onCheckedChange={() => toggleReminder('reminder_due_today')}
                    disabled={isUpdating}
                    className="flex-shrink-0"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium">Payment Overdue (1 Day)</h4>
                      <Badge variant="secondary" className="text-xs whitespace-nowrap">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders 1 day after payment due date
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_overdue_1d ?? true}
                    onCheckedChange={() => toggleReminder('reminder_overdue_1d')}
                    disabled={isUpdating}
                    className="flex-shrink-0"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium">Payment Overdue (Multiple Days)</h4>
                      <Badge variant="secondary" className="text-xs whitespace-nowrap">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders for payments overdue by multiple days
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_overdue_multi ?? true}
                    onCheckedChange={() => toggleReminder('reminder_overdue_multi')}
                    disabled={isUpdating}
                    className="flex-shrink-0"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium">Payment Due Soon (2 Days)</h4>
                      <Badge variant="secondary" className="text-xs whitespace-nowrap">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders 2 days before payment due date
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_due_soon_2d ?? false}
                    onCheckedChange={() => toggleReminder('reminder_due_soon_2d')}
                    disabled={isUpdating}
                    className="flex-shrink-0"
                  />
                </div>
              </div>

              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Delivery Mode</h4>
                <p className="text-sm text-muted-foreground">
                  Currently set to "In-App Only". Email and WhatsApp delivery options will be available in future updates.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Advanced Reminder Rules Configuration */}
          <ReminderRulesConfig />
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments" className="space-y-6">
          {/* Admin Portal Payment Mode */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Admin Portal Payment Mode
              </CardTitle>
              <CardDescription>
                Configure how payments created in the admin portal are processed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {/* Mode Selection */}
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Automated Mode Card */}
                  <div
                    className={`flex-1 p-4 border-2 rounded-lg cursor-pointer transition-all ${settings?.payment_mode === 'automated'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                      }`}
                    onClick={() => setPaymentMode('automated')}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${settings?.payment_mode === 'automated'
                        ? 'border-primary'
                        : 'border-muted-foreground'
                        }`}>
                        {settings?.payment_mode === 'automated' && (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">Automated</h4>
                          <Badge variant="secondary" className="text-xs">Default</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Payments are automatically approved when Stripe confirms the transaction. Rentals proceed immediately without admin intervention.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Manual Mode Card */}
                  <div
                    className={`flex-1 p-4 border-2 rounded-lg cursor-pointer transition-all ${settings?.payment_mode === 'manual'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                      }`}
                    onClick={() => setPaymentMode('manual')}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${settings?.payment_mode === 'manual'
                        ? 'border-primary'
                        : 'border-muted-foreground'
                        }`}>
                        {settings?.payment_mode === 'manual' && (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">Manual Approval</h4>
                          <Badge variant="outline" className="text-xs">Review Required</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          All payments require admin approval before the rental proceeds. You'll receive notifications for each payment to review.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Current Mode Info */}
                <div className={`p-4 rounded-lg ${settings?.payment_mode === 'manual'
                  ? 'bg-orange-50 border border-orange-200'
                  : 'bg-green-50 border border-green-200'
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${settings?.payment_mode === 'manual'
                      ? 'bg-orange-100 text-orange-600'
                      : 'bg-green-100 text-green-600'
                      }`}>
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className={`font-medium ${settings?.payment_mode === 'manual'
                        ? 'text-orange-800'
                        : 'text-green-800'
                        }`}>
                        {settings?.payment_mode === 'manual'
                          ? 'Manual Approval is Active'
                          : 'Automated Processing is Active'
                        }
                      </h4>
                      <p className={`text-sm mt-1 ${settings?.payment_mode === 'manual'
                        ? 'text-orange-700'
                        : 'text-green-700'
                        }`}>
                        {settings?.payment_mode === 'manual'
                          ? 'New payments will appear in the Payments page with "Pending Review" status. Accept or reject each payment to proceed with the rental.'
                          : 'Payments are processed automatically. Rentals will proceed as soon as Stripe confirms the payment.'
                        }
                      </p>
                    </div>
                  </div>
                </div>

                {/* Manual Mode Features */}
                {settings?.payment_mode === 'manual' && (
                  <div className="space-y-3">
                    <h4 className="font-medium">What happens in Manual Mode:</h4>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span>Stripe charges the customer's card immediately (as usual)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span>Payment appears in your Payments page with "Pending Review" status</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span>You receive an in-app and email notification to review</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span><strong>Accept:</strong> Rental proceeds normally</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span><strong>Reject:</strong> Rental is marked as rejected, customer is notified via email</span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stripe Connect Tab */}
        <TabsContent value="stripe-connect" className="space-y-6">
          <StripeConnectSettings />
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations" className="space-y-6">
          <LocationSettings />
        </TabsContent>

        {/* Rental Tab */}
        <TabsContent value="rental" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="h-5 w-5 text-primary" />
                Rental Requirements
              </CardTitle>
              <CardDescription>
                Configure the minimum age requirement for drivers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Minimum Rental Age */}
              <div className="space-y-2">
                <Label htmlFor="minimum_rental_age">Minimum Driver Age</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="minimum_rental_age"
                    type="number"
                    min="16"
                    max="100"
                    value={rentalForm.minimum_rental_age}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 16;
                      setRentalForm(prev => ({
                        ...prev,
                        minimum_rental_age: Math.max(16, Math.min(100, value))
                      }));
                    }}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">years old</span>
                </div>
              </div>



              {/* Save Button */}
              <Button
                onClick={async () => {
                  try {
                    await updateRentalSettings({
                      minimum_rental_age: rentalForm.minimum_rental_age,
                    });
                  } catch (error) {
                    console.error('Failed to update rental settings:', error);
                  }
                }}
                disabled={isUpdatingRentalSettings}
                className="flex items-center gap-2"
              >
                {isUpdatingRentalSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
            </CardContent>
          </Card>

          {/* Tax Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                Tax Configuration
              </CardTitle>
              <CardDescription>
                Configure tax settings for customer bookings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">Enable Tax</h4>
                  <p className="text-sm text-muted-foreground">
                    Add tax as a separate line item on customer invoices
                  </p>
                </div>
                <Switch
                  checked={rentalForm.tax_enabled ?? false}
                  onCheckedChange={(checked) => {
                    setRentalForm(prev => ({ ...prev, tax_enabled: checked }));
                  }}
                />
              </div>

              {rentalForm.tax_enabled && (
                <div className="space-y-2">
                  <Label htmlFor="tax_percentage">Tax Rate (%)</Label>
                  <div className="flex items-center gap-4">
                    <Input
                      id="tax_percentage"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={rentalForm.tax_percentage ?? 0}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || 0;
                        setRentalForm(prev => ({
                          ...prev,
                          tax_percentage: Math.max(0, Math.min(100, value))
                        }));
                      }}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tax is added on top of the rental amount
                  </p>
                </div>
              )}

              <Button
                onClick={async () => {
                  try {
                    await updateRentalSettings({
                      tax_enabled: rentalForm.tax_enabled,
                      tax_percentage: rentalForm.tax_percentage,
                    });
                  } catch (error) {
                    console.error('Failed to update tax settings:', error);
                  }
                }}
                disabled={isUpdatingRentalSettings}
                className="flex items-center gap-2"
              >
                {isUpdatingRentalSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Tax Settings
              </Button>
            </CardContent>
          </Card>

          {/* Service Fee Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-primary" />
                Service Fee
              </CardTitle>
              <CardDescription>
                Configure a service fee for customer bookings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">Enable Service Fee</h4>
                  <p className="text-sm text-muted-foreground">
                    Add a service fee to customer invoices
                  </p>
                </div>
                <Switch
                  checked={rentalForm.service_fee_enabled ?? false}
                  onCheckedChange={(checked) => {
                    setRentalForm(prev => ({ ...prev, service_fee_enabled: checked }));
                  }}
                />
              </div>

              {rentalForm.service_fee_enabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="service_fee_type">Type</Label>
                    <Select
                      value={rentalForm.service_fee_type}
                      onValueChange={(value: 'percentage' | 'fixed_amount') => {
                        setRentalForm(prev => ({ ...prev, service_fee_type: value }));
                      }}
                    >
                      <SelectTrigger id="service_fee_type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="service_fee_value">
                      {rentalForm.service_fee_type === 'percentage' ? 'Type Value' : 'Type Value'}
                    </Label>
                    <div className="relative">
                      {rentalForm.service_fee_type === 'fixed_amount' && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      )}
                      <Input
                        id="service_fee_value"
                        type="number"
                        min="0"
                        max={rentalForm.service_fee_type === 'percentage' ? 100 : undefined}
                        step={rentalForm.service_fee_type === 'percentage' ? '1' : '0.01'}
                        value={rentalForm.service_fee_value ?? 0}
                        onChange={(e) => {
                          let value = parseFloat(e.target.value) || 0;
                          // Cap percentage at 100
                          if (rentalForm.service_fee_type === 'percentage' && value > 100) {
                            value = 100;
                          }
                          setRentalForm(prev => ({
                            ...prev,
                            service_fee_value: Math.max(0, value),
                            // Keep service_fee_amount in sync for backward compatibility
                            service_fee_amount: Math.max(0, value)
                          }));
                        }}
                        className={rentalForm.service_fee_type === 'fixed_amount' ? 'pl-7' : ''}
                        placeholder={rentalForm.service_fee_type === 'percentage' ? 'e.g. 10 (for 10%)' : 'e.g. 25.00'}
                      />
                      {rentalForm.service_fee_type === 'percentage' && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {rentalForm.service_fee_type === 'percentage'
                        ? 'Percentage of the rental total added as service fee'
                        : 'Fixed amount added to each booking'}
                    </p>
                  </div>
                </div>
              )}

              <Button
                onClick={async () => {
                  try {
                    await updateRentalSettings({
                      service_fee_enabled: rentalForm.service_fee_enabled,
                      service_fee_amount: rentalForm.service_fee_value,
                      service_fee_type: rentalForm.service_fee_type,
                      service_fee_value: rentalForm.service_fee_value,
                    });
                  } catch (error) {
                    console.error('Failed to update service fee settings:', error);
                  }
                }}
                disabled={isUpdatingRentalSettings}
                className="flex items-center gap-2"
              >
                {isUpdatingRentalSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Service Fee Settings
              </Button>
            </CardContent>
          </Card>

          {/* Security Deposit Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security Deposit
              </CardTitle>
              <CardDescription>
                Configure security deposit for customer bookings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Deposit Mode Selection */}
              <RadioGroup
                value={rentalForm.deposit_mode}
                onValueChange={(value) => setRentalForm(prev => ({
                  ...prev,
                  deposit_mode: value as 'global' | 'per_vehicle'
                }))}
                className="space-y-3"
              >
                <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50"
                  onClick={() => setRentalForm(prev => ({ ...prev, deposit_mode: 'global' }))}>
                  <RadioGroupItem value="global" id="deposit-global" />
                  <Label htmlFor="deposit-global" className="flex-1 cursor-pointer">
                    <div className="font-medium">Global Deposit</div>
                    <div className="text-sm text-muted-foreground">
                      Same deposit amount for all vehicles
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50"
                  onClick={() => setRentalForm(prev => ({ ...prev, deposit_mode: 'per_vehicle' }))}>
                  <RadioGroupItem value="per_vehicle" id="deposit-per-vehicle" />
                  <Label htmlFor="deposit-per-vehicle" className="flex-1 cursor-pointer">
                    <div className="font-medium">Per-Vehicle Deposit</div>
                    <div className="text-sm text-muted-foreground">
                      Set deposit amount individually for each vehicle
                    </div>
                  </Label>
                </div>
              </RadioGroup>

              {/* Global Deposit Amount (only when mode is global) */}
              {rentalForm.deposit_mode === 'global' && (
                <div className="space-y-2">
                  <Label htmlFor="global_deposit_amount">Global Deposit Amount</Label>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="global_deposit_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={rentalForm.global_deposit_amount ?? 0}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 0;
                          setRentalForm(prev => ({
                            ...prev,
                            global_deposit_amount: Math.max(0, value)
                          }));
                        }}
                        className="w-32 pl-7"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This amount will be applied to all bookings
                  </p>
                </div>
              )}

              {rentalForm.deposit_mode === 'per_vehicle' && (
                <Alert>
                  <AlertDescription>
                    Set deposit amounts when adding or editing vehicles. Vehicles without a deposit will show $0.
                  </AlertDescription>
                </Alert>
              )}

              <Button
                onClick={async () => {
                  try {
                    await updateRentalSettings({
                      deposit_mode: rentalForm.deposit_mode,
                      global_deposit_amount: rentalForm.global_deposit_amount,
                    });
                  } catch (error) {
                    console.error('Failed to update deposit settings:', error);
                  }
                }}
                disabled={isUpdatingRentalSettings}
                className="flex items-center gap-2"
              >
                {isUpdatingRentalSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Deposit Settings
              </Button>
            </CardContent>
          </Card>

          {/* Working Hours Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Working Hours
              </CardTitle>
              <CardDescription>
                Set when your business accepts bookings. Customers outside these hours will see a disabled booking form.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Always Open Toggle */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">24/7 Always Open</h4>
                  <p className="text-sm text-muted-foreground">
                    Allow bookings at any time without restrictions
                  </p>
                </div>
                <Switch
                  checked={rentalForm.working_hours_always_open ?? false}
                  onCheckedChange={(checked) => {
                    setRentalForm(prev => ({ ...prev, working_hours_always_open: checked }));
                  }}
                />
              </div>

              {/* Business Timezone Selection - Above time inputs */}
              <div className="space-y-2">
                <Label htmlFor="business_timezone">Business Timezone</Label>
                <Select
                  value={rentalForm.timezone}
                  onValueChange={(value) => setRentalForm(prev => ({ ...prev, timezone: value }))}
                >
                  <SelectTrigger id="business_timezone" className="w-full">
                    <SelectValue placeholder="Select your business timezone">
                      {findTimezone(rentalForm.timezone)?.label || rentalForm.timezone}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {getTimezonesByRegion().map((group) => (
                      <React.Fragment key={group.region}>
                        <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground bg-muted/50">
                          {group.label}
                        </div>
                        {group.timezones.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  All working hours will be based on this timezone. Customers booking from different timezones will see times converted accordingly.
                </p>
              </div>

              {/* Time Selection (shown when not 24/7) */}
              {!rentalForm.working_hours_always_open && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="working_hours_open">Opening Time</Label>
                    <Input
                      id="working_hours_open"
                      type="time"
                      value={rentalForm.working_hours_open}
                      onChange={(e) => setRentalForm(prev => ({ ...prev, working_hours_open: e.target.value }))}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="working_hours_close">Closing Time</Label>
                    <Input
                      id="working_hours_close"
                      type="time"
                      value={rentalForm.working_hours_close}
                      onChange={(e) => setRentalForm(prev => ({ ...prev, working_hours_close: e.target.value }))}
                      className="w-full"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={async () => {
                  try {
                    // Update working hours settings
                    await updateRentalSettings({
                      working_hours_enabled: true,
                      working_hours_always_open: rentalForm.working_hours_always_open,
                      working_hours_open: rentalForm.working_hours_open,
                      working_hours_close: rentalForm.working_hours_close,
                    });
                    // Update timezone in tenant table separately
                    if (tenant?.id) {
                      const { error } = await supabase
                        .from('tenants')
                        .update({ timezone: rentalForm.timezone })
                        .eq('id', tenant.id);
                      if (error) throw error;
                      // Invalidate tenant cache to refresh
                      queryClient.invalidateQueries({ queryKey: ['tenant'] });
                    }
                  } catch (error) {
                    console.error('Failed to update working hours:', error);
                    toast({
                      title: "Error",
                      description: "Failed to update working hours settings",
                      variant: "destructive",
                    });
                  }
                }}
                disabled={isUpdatingRentalSettings}
                className="flex items-center gap-2"
              >
                {isUpdatingRentalSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Working Hours
              </Button>
            </CardContent>
          </Card>

          {/* Promo Code Card UI */}
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="inline-block bg-primary/10 rounded-full p-2">
                  <Zap className="h-5 w-5 text-primary" />
                </span>
                Promo Code
              </CardTitle>
              <CardDescription>
                Create and manage promo codes for your customers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Promo Code Name */}
              <div className="space-y-2">
                <Label htmlFor="promo_name">Promo Code Name</Label>
                <Input
                  id="promo_name"
                  placeholder="e.g. WINTER2026"
                  className="max-w-md"
                  value={promoForm.name}
                  onChange={(e) => setPromoForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              {/* Creation and Expiration Dates */}
              <div className="flex flex-col md:flex-row gap-4">
                <div className="space-y-2 w-full md:w-1/2">
                  <Label>Creation Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={`w-full justify-start text-left font-normal ${!promoForm.created_at && "text-muted-foreground"}`}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {promoForm.created_at ? format(promoForm.created_at, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={promoForm.created_at}
                        onSelect={(date) => date && setPromoForm(prev => ({ ...prev, created_at: date }))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2 w-full md:w-1/2">
                  <Label>Expiration Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={`w-full justify-start text-left font-normal ${!promoForm.expires_at && "text-muted-foreground"}`}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {promoForm.expires_at ? format(promoForm.expires_at, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={promoForm.expires_at}
                        onSelect={(date) => date && setPromoForm(prev => ({ ...prev, expires_at: date }))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Type Selection */}
              <div className="flex flex-col md:flex-row gap-4">
                <div className="space-y-2 w-full md:w-1/2">
                  <Label htmlFor="promo_type">Type</Label>
                  <Select
                    value={promoForm.type}
                    onValueChange={(val) => setPromoForm(prev => ({ ...prev, type: val }))}
                  >
                    <SelectTrigger id="promo_type" className="max-w-md">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="value">Value</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 w-full md:w-1/2">
                  <Label htmlFor="promo_type_value">Type Value</Label>
                  <Input
                    id="promo_type_value"
                    placeholder={promoForm.type === 'percentage' ? "e.g. 10 (for 10%)" : "e.g. 20.00"}
                    className="max-w-md"
                    value={promoForm.value}
                    onChange={(e) => setPromoForm(prev => ({ ...prev, value: e.target.value }))}
                    type="number"
                  />
                </div>
              </div>

              {/* Autogenerated Promo Code Value */}
              <div className="space-y-2">
                <Label htmlFor="promo_code_value">Promo Code (Autogenerated)</Label>
                <div className="flex gap-2 max-w-md">
                  <Input
                    id="promo_code_value"
                    value={promoForm.code}
                    readOnly
                    className="bg-muted"
                  />
                  <Button variant="outline" size="icon" onClick={generatePromoCode} title="Regenerate Code">
                    <Zap className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Max Users Field */}
              <div className="space-y-2">
                <Label htmlFor="promo_max_users">Max Users</Label>
                <Input
                  id="promo_max_users"
                  type="number"
                  placeholder="e.g. 100"
                  className="max-w-md"
                  value={promoForm.max_users}
                  onChange={(e) => setPromoForm(prev => ({ ...prev, max_users: e.target.value }))}
                />
              </div>

              {/* Add Button */}
              <div className="pt-2">
                <Button
                  onClick={handleCreatePromo}
                  disabled={createPromoMutation.isPending}
                  className="w-full md:w-auto"
                >
                  {createPromoMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Add Promo Code
                    </>
                  )}
                </Button>
              </div>

              <Separator className="my-6" />

              {/* Promo Codes List */}
              <div className="space-y-4">
                <Label className="text-base">All Promo Codes</Label>
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-3 text-left font-semibold">Name</th>
                          <th className="p-3 text-left font-semibold">Type</th>
                          <th className="p-3 text-left font-semibold">Value</th>
                          <th className="p-3 text-left font-semibold">Created</th>
                          <th className="p-3 text-left font-semibold">Expires</th>
                          <th className="p-3 text-left font-semibold">Max Users</th>
                          <th className="p-3 text-left font-semibold">Code</th>
                          <th className="p-3 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isLoadingPromos ? (
                          <tr>
                            <td colSpan={8} className="p-4 text-center text-muted-foreground">
                              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                              Loading promo codes...
                            </td>
                          </tr>
                        ) : promoCodes && promoCodes.length > 0 ? (
                          promoCodes.map((promo: any) => (
                            <tr key={promo.id} className="border-t hover:bg-muted/50 transition-colors">
                              <td className="p-3 font-medium">{promo.name}</td>
                              <td className="p-3 capitalize">{promo.type}</td>
                              <td className="p-3">
                                {promo.type === 'percentage' ? `${promo.value}%` : `$${Number(promo.value).toFixed(2)}`}
                              </td>
                              <td className="p-3 text-muted-foreground">{promo.created_at}</td>
                              <td className="p-3 text-muted-foreground">{promo.expires_at}</td>
                              <td className="p-3">{promo.max_users}</td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="font-mono">{promo.code}</Badge>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                                    onClick={() => {
                                      navigator.clipboard.writeText(promo.code);
                                      toast({ title: "Copied!", description: "Promo code copied to clipboard" });
                                    }}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    onClick={() => setEditingPromo({
                                      ...promo,
                                      // Ensure dates are date objects for calendar
                                      expires_at: new Date(promo.expires_at)
                                    })}
                                  >
                                    <FilePenLine className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => setDeletingPromo(promo)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={8} className="p-8 text-center text-muted-foreground">
                              No promo codes found. Create one to get started.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Edit Promo Dialog */}
          <Dialog open={!!editingPromo} onOpenChange={(open) => !open && setEditingPromo(null)}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Edit Promo Code</DialogTitle>
                <DialogDescription>
                  Update the details of your promo code. Code string cannot be changed.
                </DialogDescription>
              </DialogHeader>
              {editingPromo && (
                <div className="space-y-6 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_name">Name</Label>
                    <Input
                      id="edit_name"
                      value={editingPromo.name}
                      onChange={(e) => setEditingPromo({ ...editingPromo, name: e.target.value })}
                    />
                  </div>

                  <div className="flex gap-4">
                    <div className="space-y-2 w-1/2">
                      <Label>Expiration Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {editingPromo.expires_at ? format(editingPromo.expires_at, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editingPromo.expires_at}
                            onSelect={(date) => date && setEditingPromo({ ...editingPromo, expires_at: date })}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2 w-1/2">
                      <Label htmlFor="edit_max_users">Max Users</Label>
                      <Input
                        id="edit_max_users"
                        type="number"
                        value={editingPromo.max_users}
                        onChange={(e) => setEditingPromo({ ...editingPromo, max_users: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="space-y-2 w-1/2">
                      <Label htmlFor="edit_type">Type</Label>
                      <Select
                        value={editingPromo.type}
                        onValueChange={(val) => setEditingPromo({ ...editingPromo, type: val })}
                      >
                        <SelectTrigger id="edit_type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Percentage</SelectItem>
                          <SelectItem value="value">Value</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 w-1/2">
                      <Label htmlFor="edit_value">Value</Label>
                      <Input
                        id="edit_value"
                        type="number"
                        value={editingPromo.value}
                        onChange={(e) => setEditingPromo({ ...editingPromo, value: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Promo Code (Read Only)</Label>
                    <Input value={editingPromo.code} readOnly className="bg-muted" />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingPromo(null)}>Cancel</Button>
                <Button onClick={handleUpdatePromo} disabled={updatePromoMutation.isPending}>
                  {updatePromoMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={!!deletingPromo} onOpenChange={(open) => !open && setDeletingPromo(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Delete Promo Code?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete the promo code <strong>{deletingPromo?.name}</strong>?
                  This action cannot be undone and may affect active users trying to use this code.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90"
                  onClick={() => deletingPromo && deletePromoMutation.mutate(deletingPromo.id)}
                >
                  {deletePromoMutation.isPending ? "Deleting..." : "Delete Promo Code"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* Agreement Tab */}
        <TabsContent value="agreement" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Agreement Templates
              </CardTitle>
              <CardDescription>
                Customize the rental agreement template used for DocuSign contracts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Create and manage agreement templates that will be used when sending rental contracts via DocuSign.
                Each tenant can have their own customized template with variable placeholders for customer, vehicle, and rental information.
              </p>
              <div className="flex justify-center">
                <Button
                  onClick={() => router.push('/settings/agreement-templates')}
                  className="flex items-center gap-2 w-full sm:w-64"
                >
                  <FileText className="h-4 w-4" />
                  Manage Agreement Templates
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Templates Tab */}
        <TabsContent value="emails" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Email Templates
              </CardTitle>
              <CardDescription>
                Customize the emails sent to your customers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Personalize your customer communications by customizing email templates for booking confirmations,
                reminders, and other notifications. Use variables to automatically include customer and rental details.
              </p>
              <Button
                onClick={() => router.push('/settings/email-templates')}
                className="flex items-center gap-2"
              >
                <Mail className="h-4 w-4" />
                Manage Email Templates
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Global Blacklist Tab */}
        <TabsContent value="blacklist" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldX className="h-5 w-5 text-primary" />
                Global Blacklist
              </CardTitle>
              <CardDescription>
                View customers blocked by multiple rental companies
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                When a customer is blocked by 3 or more rental companies, they are automatically added to the global blacklist.
                Blacklisted customers cannot make bookings with any rental company on the platform.
              </p>
              <Button
                onClick={() => router.push('/settings/blacklist')}
                className="flex items-center gap-2"
              >
                <ShieldX className="h-4 w-4" />
                View Global Blacklist
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Data Cleanup Dialog */}
      <DataCleanupDialog
        open={showDataCleanupDialog}
        onOpenChange={setShowDataCleanupDialog}
      />
    </div>
  );
};

export { Settings };
export default Settings;
