'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Calendar as CalendarIcon, Settings as SettingsIcon, Building2, Bell, Zap, Upload, Save, Loader2, Database, AlertTriangle, Trash2, CreditCard, Palette, Link2, CheckCircle2, AlertCircle, ExternalLink, MapPin, FileText, Car, Mail, ShieldX, FilePenLine, Receipt, Banknote, Shield, Copy, Check, Clock, Crown, Package, Lock, RefreshCw, Eye, TrendingUp } from 'lucide-react';
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
import { ExtrasSettings } from '@/components/settings/extras-settings';
import { BonzahSettings } from '@/components/settings/bonzah-settings';
import { SubscriptionSettings } from '@/components/settings/subscription-settings';
import { LockboxTemplatesSection } from '@/components/settings/lockbox-templates-section';
import { PricingRulesSettings } from '@/components/settings/pricing-rules-settings';
import { formatCurrency } from '@/lib/format-utils';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useUnsavedChangesWarning } from '@/hooks/use-unsaved-changes-warning';
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog';

const Settings = () => {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isManager, canViewSettings, canEditSettings } = useManagerPermissions();

  // All settings tab values
  const allSettingsTabs = ['general', 'locations', 'branding', 'rental', 'pricing', 'extras', 'payments', 'reminders', 'templates', 'integrations', 'subscription'];
  const visibleTabs = allSettingsTabs.filter(t => canViewSettings(t));
  const [activeTab, setActiveTab] = useState(visibleTabs[0] || 'general');
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [showDataCleanupDialog, setShowDataCleanupDialog] = useState(false);
  const [generalForm, setGeneralForm] = useState({
    currency_code: 'USD',
    distance_unit: 'miles' as 'km' | 'miles',
    privacy_policy_version: '1.0',
    terms_version: '1.0',
  });
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);

  // Use the new centralized settings hook - must be before useEffects that depend on it
  const {
    settings,
    isLoading,
    error,
    updateCompanyProfile,
    updateSettingsAsync,
    toggleReminder,
    setPaymentMode,
    setBookingPaymentMode,
    updateBranding: updateOrgBranding,
    isUpdating
  } = useOrgSettings();

  // Get tenant context for ID and refetch
  const { tenant, refetchTenant } = useTenant();

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
  const [rentalForm, setRentalForm] = useState<{
    minimum_rental_age: number | '';
    tax_enabled: boolean;
    tax_percentage: number;
    service_fee_enabled: boolean;
    service_fee_amount: number;
    service_fee_type: 'percentage' | 'fixed_amount';
    service_fee_value: number;
    deposit_mode: 'global' | 'per_vehicle';
    global_deposit_amount: number;
    installments_enabled: boolean;
    installment_config: {
      min_days_for_weekly: number;
      min_days_for_monthly: number;
      max_installments_weekly: number;
      max_installments_monthly: number;
      charge_first_upfront: boolean;
      what_gets_split: 'rental_only' | 'rental_tax' | 'rental_tax_extras';
      grace_period_days: number;
      max_retry_attempts: number;
      retry_interval_days: number;
    };
    booking_lead_time_value: number;
    booking_lead_time_unit: 'hours' | 'days';
    min_rental_days: number;
    min_rental_hours: number;
    max_rental_days: number;
    lockbox_enabled: boolean;
    lockbox_code_length: number | null;
    lockbox_notification_methods: string[];
  }>({
    minimum_rental_age: '',
    tax_enabled: false,
    tax_percentage: 0,
    service_fee_enabled: false,
    service_fee_amount: 0,
    service_fee_type: 'fixed_amount' as 'percentage' | 'fixed_amount',
    service_fee_value: 0,
    deposit_mode: 'global' as 'global' | 'per_vehicle',
    global_deposit_amount: 0,
    // Installment settings
    installments_enabled: false,
    installment_config: {
      min_days_for_weekly: 7,
      min_days_for_monthly: 30,
      max_installments_weekly: 4,
      max_installments_monthly: 6,
      // Phase 3 additions
      charge_first_upfront: true,
      what_gets_split: 'rental_tax' as 'rental_only' | 'rental_tax' | 'rental_tax_extras',
      grace_period_days: 3,
      max_retry_attempts: 3,
      retry_interval_days: 1,
    } as {
      min_days_for_weekly: number;
      min_days_for_monthly: number;
      max_installments_weekly: number;
      max_installments_monthly: number;
      charge_first_upfront: boolean;
      what_gets_split: 'rental_only' | 'rental_tax' | 'rental_tax_extras';
      grace_period_days: number;
      max_retry_attempts: number;
      retry_interval_days: number;
    },
    // Booking lead time
    booking_lead_time_value: 24,
    booking_lead_time_unit: 'hours' as 'hours' | 'days',
    // Rental duration limits
    min_rental_days: 0,
    min_rental_hours: 1,
    max_rental_days: 90,
    // Lockbox settings
    lockbox_enabled: false,
    lockbox_code_length: null as number | null,
    lockbox_notification_methods: ['email'] as string[],
  });

  // Sync rental form with loaded settings
  useEffect(() => {
    if (rentalSettings) {
      setRentalForm({
        minimum_rental_age: rentalSettings.minimum_rental_age || '',
        tax_enabled: rentalSettings.tax_enabled ?? false,
        tax_percentage: rentalSettings.tax_percentage ?? 0,
        service_fee_enabled: rentalSettings.service_fee_enabled ?? false,
        service_fee_amount: rentalSettings.service_fee_amount ?? 0,
        service_fee_type: (rentalSettings.service_fee_type as 'percentage' | 'fixed_amount') ?? 'fixed_amount',
        service_fee_value: rentalSettings.service_fee_value ?? rentalSettings.service_fee_amount ?? 0,
        deposit_mode: rentalSettings.deposit_mode ?? 'global',
        global_deposit_amount: rentalSettings.global_deposit_amount ?? 0,
        // Installment settings
        installments_enabled: rentalSettings.installments_enabled ?? false,
        installment_config: {
          min_days_for_weekly: rentalSettings.installment_config?.min_days_for_weekly ?? 7,
          min_days_for_monthly: rentalSettings.installment_config?.min_days_for_monthly ?? 30,
          max_installments_weekly: rentalSettings.installment_config?.max_installments_weekly ?? 4,
          max_installments_monthly: rentalSettings.installment_config?.max_installments_monthly ?? 6,
          // Phase 3 additions
          charge_first_upfront: rentalSettings.installment_config?.charge_first_upfront ?? true,
          what_gets_split: rentalSettings.installment_config?.what_gets_split ?? 'rental_tax',
          grace_period_days: rentalSettings.installment_config?.grace_period_days ?? 3,
          max_retry_attempts: rentalSettings.installment_config?.max_retry_attempts ?? 3,
          retry_interval_days: rentalSettings.installment_config?.retry_interval_days ?? 1,
        },
        // Booking lead time - convert stored hours back to display value based on unit
        booking_lead_time_unit: (rentalSettings.booking_lead_time_unit as 'hours' | 'days') ?? 'hours',
        booking_lead_time_value: (rentalSettings.booking_lead_time_unit === 'days' && rentalSettings.booking_lead_time_hours)
          ? rentalSettings.booking_lead_time_hours / 24
          : rentalSettings.booking_lead_time_hours ?? 24,
        // Rental duration limits
        min_rental_days: rentalSettings.min_rental_days ?? 0,
        min_rental_hours: rentalSettings.min_rental_hours ?? 1,
        max_rental_days: rentalSettings.max_rental_days ?? 90,
        // Lockbox settings
        lockbox_enabled: rentalSettings.lockbox_enabled ?? false,
        lockbox_code_length: rentalSettings.lockbox_code_length ?? null,
        lockbox_notification_methods: (rentalSettings.lockbox_notification_methods as string[]) ?? ['email'],
      });
    }
  }, [rentalSettings]);

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['general', 'branding', 'reminders', 'payments', 'locations', 'rental', 'extras', 'templates', 'integrations', 'subscription'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Sync general form with loaded settings and tenant context
  useEffect(() => {
    setGeneralForm({
      currency_code: settings?.currency_code || tenant?.currency_code || 'USD',
      distance_unit: (settings?.distance_unit as 'km' | 'miles') || (tenant?.distance_unit as 'km' | 'miles') || 'miles',
      privacy_policy_version: tenant?.privacy_policy_version || '1.0',
      terms_version: tenant?.terms_version || '1.0',
    });
  }, [settings, tenant]);

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

  // --- Dirty tracking for unsaved changes warning ---
  const [locationsDirty, setLocationsDirty] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);

  const generalFormDirty = useMemo(() => {
    if (!settings && !tenant) return false;
    const origCurrency = settings?.currency_code || tenant?.currency_code || 'USD';
    const origDistance = (settings?.distance_unit as string) || (tenant?.distance_unit as string) || 'miles';
    const origPrivacy = tenant?.privacy_policy_version || '1.0';
    const origTerms = tenant?.terms_version || '1.0';
    return (
      generalForm.currency_code !== origCurrency ||
      generalForm.distance_unit !== origDistance ||
      generalForm.privacy_policy_version !== origPrivacy ||
      generalForm.terms_version !== origTerms
    );
  }, [generalForm, settings, tenant]);

  const brandingFormDirty = useMemo(() => {
    const b = tenantBranding;
    if (!b) return false;
    return (
      brandingForm.app_name !== (b.app_name || 'Drive 917') ||
      brandingForm.primary_color !== (b.primary_color || '#C6A256') ||
      brandingForm.secondary_color !== (b.secondary_color || '#C6A256') ||
      brandingForm.accent_color !== (b.accent_color || '#C6A256') ||
      brandingForm.light_primary_color !== (b.light_primary_color || '') ||
      brandingForm.light_secondary_color !== (b.light_secondary_color || '') ||
      brandingForm.light_accent_color !== (b.light_accent_color || '') ||
      brandingForm.dark_primary_color !== (b.dark_primary_color || '') ||
      brandingForm.dark_secondary_color !== (b.dark_secondary_color || '') ||
      brandingForm.dark_accent_color !== (b.dark_accent_color || '') ||
      brandingForm.light_background_color !== (b.light_background_color || '') ||
      brandingForm.dark_background_color !== (b.dark_background_color || '') ||
      brandingForm.light_header_footer_color !== (b.light_header_footer_color || '') ||
      brandingForm.dark_header_footer_color !== (b.dark_header_footer_color || '') ||
      brandingForm.meta_title !== (b.meta_title || '') ||
      brandingForm.meta_description !== (b.meta_description || '') ||
      brandingForm.og_image_url !== (b.og_image_url || '') ||
      brandingForm.favicon_url !== (b.favicon_url || '')
    );
  }, [brandingForm, tenantBranding]);

  const rentalFormDirty = useMemo(() => {
    if (!rentalSettings) return false;
    const rs = rentalSettings;
    return (
      (rentalForm.minimum_rental_age || null) !== (rs.minimum_rental_age || null) ||
      rentalForm.tax_enabled !== (rs.tax_enabled ?? false) ||
      rentalForm.tax_percentage !== (rs.tax_percentage ?? 0) ||
      rentalForm.service_fee_enabled !== (rs.service_fee_enabled ?? false) ||
      rentalForm.service_fee_type !== ((rs.service_fee_type as string) ?? 'fixed_amount') ||
      rentalForm.service_fee_value !== (rs.service_fee_value ?? rs.service_fee_amount ?? 0) ||
      rentalForm.deposit_mode !== (rs.deposit_mode ?? 'global') ||
      rentalForm.global_deposit_amount !== (rs.global_deposit_amount ?? 0) ||
      rentalForm.installments_enabled !== (rs.installments_enabled ?? false) ||
      rentalForm.lockbox_enabled !== (rs.lockbox_enabled ?? false) ||
      rentalForm.lockbox_code_length !== (rs.lockbox_code_length ?? null) ||
      rentalForm.min_rental_days !== (rs.min_rental_days ?? 0) ||
      rentalForm.min_rental_hours !== (rs.min_rental_hours ?? 1) ||
      rentalForm.max_rental_days !== (rs.max_rental_days ?? 90)
    );
  }, [rentalForm, rentalSettings]);

  const hasUnsavedChanges = generalFormDirty || brandingFormDirty || rentalFormDirty || locationsDirty || pricingDirty;

  // Per-tab dirty mapping for tab switch guard
  const tabDirtyMap: Record<string, boolean> = useMemo(() => ({
    general: generalFormDirty,
    branding: brandingFormDirty,
    rental: rentalFormDirty,
    locations: locationsDirty,
    pricing: pricingDirty,
  }), [generalFormDirty, brandingFormDirty, rentalFormDirty, locationsDirty, pricingDirty]);

  // Tab switch guard state
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [showTabWarning, setShowTabWarning] = useState(false);

  const handleTabChange = useCallback((newTab: string) => {
    // Check if current tab has unsaved changes
    if (tabDirtyMap[activeTab]) {
      setPendingTab(newTab);
      setShowTabWarning(true);
    } else {
      setActiveTab(newTab);
    }
  }, [activeTab, tabDirtyMap]);

  const handleTabDiscardAndSwitch = useCallback(() => {
    setShowTabWarning(false);
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  }, [pendingTab]);

  const handleTabCancel = useCallback(() => {
    setPendingTab(null);
    setShowTabWarning(false);
  }, []);

  // Save all dirty main forms (for "Save & Leave")
  const saveAllDirtyForms = useCallback(async (): Promise<boolean> => {
    try {
      const saves: Promise<void>[] = [];

      if (generalFormDirty) {
        saves.push((async () => {
          setIsSavingGeneral(true);
          try {
            await updateSettingsAsync({
              currency_code: generalForm.currency_code,
              distance_unit: generalForm.distance_unit,
            });
            if (tenant?.id) {
              const policyVersionChanged =
                generalForm.privacy_policy_version !== (tenant?.privacy_policy_version || '1.0') ||
                generalForm.terms_version !== (tenant?.terms_version || '1.0');
              await supabase
                .from('tenants')
                .update({
                  distance_unit: generalForm.distance_unit,
                  currency_code: generalForm.currency_code,
                  privacy_policy_version: generalForm.privacy_policy_version,
                  terms_version: generalForm.terms_version,
                  ...(policyVersionChanged ? { policies_accepted_at: null } : {}),
                })
                .eq('id', tenant.id);
              await refetchTenant();
            }
          } finally {
            setIsSavingGeneral(false);
          }
        })());
      }

      if (brandingFormDirty) {
        saves.push((async () => {
          setIsSavingBranding(true);
          try {
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
            await updateTenantBranding(brandingData);
            await updateOrgBranding(brandingData);
          } finally {
            setIsSavingBranding(false);
          }
        })());
      }

      await Promise.all(saves);
      return true;
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save some settings. Please try again.',
        variant: 'destructive',
      });
      return false;
    }
  }, [generalFormDirty, brandingFormDirty, generalForm, brandingForm, tenant, tenantBranding, updateSettingsAsync, updateTenantBranding, updateOrgBranding, refetchTenant, supabase, toast]);

  const {
    isDialogOpen: unsavedDialogOpen,
    confirmLeave,
    saveAndLeave,
    cancelLeave,
    isSaving: isSavingNav,
  } = useUnsavedChangesWarning({ hasChanges: hasUnsavedChanges, onSave: saveAllDirtyForms });

  // Save & switch tab handler (needs saveAllDirtyForms defined above)
  const [isSavingForTab, setIsSavingForTab] = useState(false);
  const handleTabSaveAndSwitch = useCallback(async () => {
    setIsSavingForTab(true);
    try {
      const success = await saveAllDirtyForms();
      if (success && pendingTab) {
        setActiveTab(pendingTab);
        setPendingTab(null);
        setShowTabWarning(false);
      }
    } catch {
      // stay on current tab
    } finally {
      setIsSavingForTab(false);
    }
  }, [pendingTab, saveAllDirtyForms]);

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
    queryKey: ['promocodes', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('promocodes')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching promocodes:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!tenant?.id,
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
        .eq('tenant_id', tenant.id)
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
        .eq('id', id)
        .eq('tenant_id', tenant.id);

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

  const handleSaveGeneralSettings = async () => {
    setIsSavingGeneral(true);
    try {
      // Update currency_code and distance_unit in org_settings
      await updateSettingsAsync({
        currency_code: generalForm.currency_code,
        distance_unit: generalForm.distance_unit,
      });

      // Also update distance_unit and policy versions on the tenants table (primary source for tenant context)
      if (tenant?.id) {
        // Reset tenant-level acceptance if policy versions changed
        const policyVersionChanged =
          generalForm.privacy_policy_version !== (tenant?.privacy_policy_version || '1.0') ||
          generalForm.terms_version !== (tenant?.terms_version || '1.0');

        const { error: tenantError } = await supabase
          .from('tenants')
          .update({
            distance_unit: generalForm.distance_unit,
            currency_code: generalForm.currency_code,
            privacy_policy_version: generalForm.privacy_policy_version,
            terms_version: generalForm.terms_version,
            ...(policyVersionChanged ? { policies_accepted_at: null } : {}),
          })
          .eq('id', tenant.id);

        if (tenantError) {
          console.error('Failed to update tenant distance_unit:', tenantError);
        } else {
          // Refresh tenant context so the new values propagate
          await refetchTenant();
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save general settings",
        variant: "destructive",
      });
    } finally {
      setIsSavingGeneral(false);
    }
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
        description: `Processed ${data[0]?.payments_processed || 0} payments, affected ${data[0]?.customers_affected || 0} customers, applied ${formatCurrency(data[0]?.total_credit_applied || 0, tenant?.currency_code || 'USD')} in credit. Duration: ${duration}s`,
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
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure your fleet management system
        </p>
      </div>

      {/* Settings Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Mobile: Horizontal scrollable nav */}
          <div className="lg:hidden">
            <TabsList className="flex w-full overflow-x-auto gap-1 bg-muted/50 p-1 rounded-lg">
              {([
                { value: 'general', icon: Building2, label: 'General' },
                { value: 'locations', icon: MapPin, label: 'Locations' },
                { value: 'branding', icon: Palette, label: 'Branding' },
                { value: 'rental', icon: Car, label: 'Bookings' },
                { value: 'pricing', icon: TrendingUp, label: 'Pricing' },
                { value: 'extras', icon: Package, label: 'Extras' },
                { value: 'payments', icon: CreditCard, label: 'Payments' },
                { value: 'reminders', icon: Bell, label: 'Notifications' },
                { value: 'templates', icon: FileText, label: 'Templates' },
                { value: 'integrations', icon: Shield, label: 'Integrations' },
                { value: 'subscription', icon: Crown, label: 'Subscription' },
              ] as const).filter(item => canViewSettings(item.value)).map(item => (
                <TabsTrigger key={item.value} value={item.value} className="flex items-center gap-1.5 whitespace-nowrap text-xs px-3">
                  <item.icon className="h-3.5 w-3.5" />{item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Desktop: Vertical sidebar nav */}
          <nav className="hidden lg:block w-52 shrink-0">
            <div className="sticky top-6 rounded-lg border bg-card p-2 space-y-1">
              {/* Business group */}
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pt-1 pb-0.5">Business</p>
              {([
                { value: 'general', icon: Building2, label: 'General' },
                { value: 'locations', icon: MapPin, label: 'Locations' },
                { value: 'branding', icon: Palette, label: 'Branding' },
              ] as const).filter(item => canViewSettings(item.value)).map(item => (
                <button
                  key={item.value}
                  onClick={() => setActiveTab(item.value)}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
                    activeTab === item.value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              ))}

              <Separator className="!my-2" />

              {/* Operations group */}
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pt-0.5 pb-0.5">Operations</p>
              {([
                { value: 'rental', icon: Car, label: 'Bookings' },
                { value: 'pricing', icon: TrendingUp, label: 'Dynamic Pricing' },
                { value: 'extras', icon: Package, label: 'Extras' },
                { value: 'payments', icon: CreditCard, label: 'Payments & Stripe' },
                { value: 'reminders', icon: Bell, label: 'Notifications' },
                { value: 'templates', icon: FileText, label: 'Templates' },
              ] as const).filter(item => canViewSettings(item.value)).map(item => (
                <button
                  key={item.value}
                  onClick={() => setActiveTab(item.value)}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
                    activeTab === item.value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              ))}

              <Separator className="!my-2" />

              {/* More group */}
              {([
                { value: 'integrations', icon: Shield, label: 'Integrations' },
                { value: 'subscription', icon: Crown, label: 'Subscription' },
              ] as const).filter(item => canViewSettings(item.value)).map(item => (
                <button
                  key={item.value}
                  onClick={() => setActiveTab(item.value)}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
                    activeTab === item.value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Tab Content Area */}
          <div className="flex-1 min-w-0 space-y-6">
            {!canEditSettings(activeTab) && (
              <div className="p-3 bg-muted/50 border rounded-lg flex items-center gap-2 text-sm text-muted-foreground">
                <Eye className="h-4 w-4 shrink-0" />
                You have view-only access to this settings tab.
              </div>
            )}
            <div className={!canEditSettings(activeTab) ? "pointer-events-none select-none" : ""}>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Regional Settings
              </CardTitle>
              <CardDescription>
                Configure currency and distance units for your organisation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Currency */}
              <div className="space-y-2">
                <Label htmlFor="currency_code">Currency</Label>
                <Select
                  value={generalForm.currency_code}
                  onValueChange={(value) => setGeneralForm(prev => ({ ...prev, currency_code: value }))}
                >
                  <SelectTrigger id="currency_code" className="w-full">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD - US Dollar ($)</SelectItem>
                    <SelectItem value="GBP">GBP - British Pound (£)</SelectItem>
                    <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Currency used for pricing, invoices, and financial reports
                </p>
              </div>

              {/* Distance Unit */}
              <div className="space-y-2">
                <Label htmlFor="distance_unit">Distance Unit</Label>
                <Select
                  value={generalForm.distance_unit}
                  onValueChange={(value: 'km' | 'miles') => setGeneralForm(prev => ({ ...prev, distance_unit: value }))}
                >
                  <SelectTrigger id="distance_unit" className="w-full">
                    <SelectValue placeholder="Select distance unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="miles">Miles</SelectItem>
                    <SelectItem value="km">Kilometres</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Unit of measurement for vehicle mileage and distance tracking
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Policy & Terms Versioning */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Policy &amp; Terms Versioning
              </CardTitle>
              <CardDescription>
                When you update a version, all users must re-accept on next login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="privacy_policy_version">Privacy Policy Version</Label>
                  <Input
                    id="privacy_policy_version"
                    value={generalForm.privacy_policy_version}
                    onChange={(e) => setGeneralForm(prev => ({ ...prev, privacy_policy_version: e.target.value }))}
                    placeholder="e.g. 1.0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="terms_version">Terms &amp; Conditions Version</Label>
                  <Input
                    id="terms_version"
                    value={generalForm.terms_version}
                    onChange={(e) => setGeneralForm(prev => ({ ...prev, terms_version: e.target.value }))}
                    placeholder="e.g. 1.0"
                  />
                </div>
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Changing a version number will require all portal users to re-accept on their next login.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Save Button */}
          {canEditSettings('general') && (
            <div className="flex justify-end">
              <Button
                onClick={handleSaveGeneralSettings}
                disabled={isSavingGeneral}
                className="min-w-[120px]"
              >
                {isSavingGeneral ? (
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
          )}
        </TabsContent>

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
          {canEditSettings('branding') && (
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
          )}
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

          {/* Email Templates */}
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

        {/* Payments Tab */}
        <TabsContent value="payments" className="space-y-6">
          {/* Stripe Connect */}
          <StripeConnectSettings />
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations" className="space-y-6">
          <LocationSettings onDirtyChange={setLocationsDirty} />
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
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={rentalForm.minimum_rental_age}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/[^0-9]/g, '');
                      setRentalForm(prev => ({
                        ...prev,
                        minimum_rental_age: rawValue === '' ? '' : parseInt(rawValue)
                      }));
                    }}
                    placeholder="e.g. 21"
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">years old</span>
                </div>
              </div>



              {/* Save Button */}
              {canEditSettings('rental') && (
                <Button
                  onClick={async () => {
                    try {
                      await updateRentalSettings({
                        minimum_rental_age: rentalForm.minimum_rental_age || null,
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
              )}
            </CardContent>
          </Card>

          {/* Minimum Booking Notice Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Minimum Booking Notice
              </CardTitle>
              <CardDescription>
                Set how far in advance bookings must be made
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={rentalForm.booking_lead_time_value || ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    const val = raw === '' ? 0 : parseInt(raw);
                    setRentalForm(prev => ({ ...prev, booking_lead_time_value: val }));
                  }}
                  placeholder={rentalForm.booking_lead_time_unit === 'days' ? 'e.g. 2' : 'e.g. 24'}
                  className="w-24"
                />
                <Select
                  value={rentalForm.booking_lead_time_unit}
                  onValueChange={(value: 'hours' | 'days') => {
                    const currentHours = rentalForm.booking_lead_time_unit === 'days'
                      ? rentalForm.booking_lead_time_value * 24
                      : rentalForm.booking_lead_time_value;
                    const newValue = value === 'days' ? Math.round(currentHours / 24) : currentHours;
                    setRentalForm(prev => ({
                      ...prev,
                      booking_lead_time_unit: value,
                      booking_lead_time_value: newValue,
                    }));
                  }}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">before pickup</span>
              </div>
              {(() => {
                const totalHours = rentalForm.booking_lead_time_unit === 'days'
                  ? rentalForm.booking_lead_time_value * 24
                  : rentalForm.booking_lead_time_value;
                return (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Customers must book at least {rentalForm.booking_lead_time_value} {rentalForm.booking_lead_time_unit} in advance.
                      {rentalForm.booking_lead_time_unit === 'days' && rentalForm.booking_lead_time_value > 0 && (
                        <> ({totalHours} hours)</>
                      )}
                    </p>
                    {totalHours < 1 && (
                      <p className="text-sm text-destructive">
                        Minimum booking notice must be at least 1 hour.
                      </p>
                    )}
                  </>
                );
              })()}
              {canEditSettings('rental') && (
                <Button
                  onClick={async () => {
                    const hours = rentalForm.booking_lead_time_unit === 'days'
                      ? rentalForm.booking_lead_time_value * 24
                      : rentalForm.booking_lead_time_value;
                    if (hours < 1) {
                      toast({
                        title: "Invalid Configuration",
                        description: "Minimum booking notice must be at least 1 hour.",
                        variant: "destructive",
                      });
                      return;
                    }
                    try {
                      await updateRentalSettings({
                        booking_lead_time_hours: hours,
                        booking_lead_time_unit: rentalForm.booking_lead_time_unit,
                      });
                    } catch (error) {
                      console.error('Failed to update booking notice settings:', error);
                    }
                  }}
                  disabled={(() => {
                    const totalHours = rentalForm.booking_lead_time_unit === 'days'
                      ? rentalForm.booking_lead_time_value * 24
                      : rentalForm.booking_lead_time_value;
                    return isUpdatingRentalSettings || totalHours < 1;
                  })()}
                  className="flex items-center gap-2"
                >
                  {isUpdatingRentalSettings ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Minimum Rental Duration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="h-5 w-5 text-primary" />
                Rental Duration Limits
              </CardTitle>
              <CardDescription>
                Set minimum and maximum rental duration for bookings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Label className="w-24 text-sm">Minimum</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={rentalForm.min_rental_days || ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setRentalForm(prev => ({ ...prev, min_rental_days: raw === '' ? 0 : parseInt(raw) }));
                    }}
                    placeholder="0"
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={rentalForm.min_rental_hours || ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      const val = raw === '' ? 0 : Math.min(23, parseInt(raw) || 0);
                      setRentalForm(prev => ({ ...prev, min_rental_hours: val }));
                    }}
                    placeholder="0"
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="w-24 text-sm">Maximum</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={rentalForm.max_rental_days || ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setRentalForm(prev => ({ ...prev, max_rental_days: raw === '' ? 0 : parseInt(raw) }));
                    }}
                    placeholder="e.g. 90"
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              </div>
              {(() => {
                const totalMinHours = (rentalForm.min_rental_days || 0) * 24 + (rentalForm.min_rental_hours || 0);
                const minDaysDisplay = rentalForm.min_rental_days || 0;
                const minHoursDisplay = rentalForm.min_rental_hours || 0;
                const maxDays = rentalForm.max_rental_days || 0;
                return (
                  <>
                    {totalMinHours > 0 && maxDays > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Minimum rental: {minDaysDisplay > 0 ? `${minDaysDisplay} day${minDaysDisplay !== 1 ? 's' : ''}` : ''}{minDaysDisplay > 0 && minHoursDisplay > 0 ? ' ' : ''}{minHoursDisplay > 0 ? `${minHoursDisplay} hour${minHoursDisplay !== 1 ? 's' : ''}` : ''}{totalMinHours > 0 && ` (${totalMinHours} hours total)`}. Maximum: {maxDays} day{maxDays !== 1 ? 's' : ''}.
                      </p>
                    )}
                    {totalMinHours < 1 && (
                      <p className="text-sm text-destructive">
                        Minimum rental period must be at least 1 hour.
                      </p>
                    )}
                    {totalMinHours > 0 && maxDays > 0 && totalMinHours > maxDays * 24 && (
                      <p className="text-sm text-destructive">
                        Minimum duration cannot exceed maximum duration.
                      </p>
                    )}
                  </>
                );
              })()}
              <Button
                onClick={async () => {
                  const minDays = rentalForm.min_rental_days || 0;
                  const minHours = Math.min(23, rentalForm.min_rental_hours || 0);
                  const totalMinHours = minDays * 24 + minHours;
                  const maxDays = rentalForm.max_rental_days || 90;
                  if (totalMinHours < 1) {
                    toast({
                      title: "Invalid Configuration",
                      description: "Minimum rental period must be at least 1 hour.",
                      variant: "destructive",
                    });
                    return;
                  }
                  if (totalMinHours > maxDays * 24) {
                    toast({
                      title: "Invalid Configuration",
                      description: "Minimum rental duration cannot exceed maximum rental duration.",
                      variant: "destructive",
                    });
                    return;
                  }
                  try {
                    await updateRentalSettings({
                      min_rental_days: minDays,
                      min_rental_hours: minHours,
                      max_rental_days: maxDays,
                    });
                    setRentalForm(prev => ({ ...prev, min_rental_days: minDays, min_rental_hours: minHours, max_rental_days: maxDays }));
                  } catch (error) {
                    console.error('Failed to update rental duration settings:', error);
                  }
                }}
                disabled={(() => {
                  const totalMinHours = (rentalForm.min_rental_days || 0) * 24 + (rentalForm.min_rental_hours || 0);
                  const maxDays = rentalForm.max_rental_days || 0;
                  return isUpdatingRentalSettings || totalMinHours < 1 || (totalMinHours > 0 && maxDays > 0 && totalMinHours > maxDays * 24);
                })()}
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
                      type="text"
                      inputMode="decimal"
                      value={rentalForm.tax_percentage ?? ''}
                      onChange={(e) => {
                        const rawValue = e.target.value.replace(/[^0-9.]/g, '');
                        if (rawValue === '' || rawValue === '.') {
                          setRentalForm(prev => ({ ...prev, tax_percentage: rawValue as any }));
                        } else {
                          const numValue = Math.max(0, Math.min(100, parseFloat(rawValue) || 0));
                          setRentalForm(prev => ({ ...prev, tax_percentage: numValue }));
                        }
                      }}
                      onBlur={(e) => {
                        const value = parseFloat(e.target.value);
                        setRentalForm(prev => ({ ...prev, tax_percentage: isNaN(value) ? 0 : Math.max(0, Math.min(100, value)) }));
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

              {canEditSettings('rental') && (
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
              )}
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
                        type="text"
                        inputMode="decimal"
                        value={rentalForm.service_fee_value ?? ''}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^0-9.]/g, '');
                          if (rawValue === '' || rawValue === '.') {
                            setRentalForm(prev => ({
                              ...prev,
                              service_fee_value: rawValue as any,
                              service_fee_amount: rawValue as any
                            }));
                          } else {
                            let value = parseFloat(rawValue) || 0;
                            if (rentalForm.service_fee_type === 'percentage' && value > 100) {
                              value = 100;
                            }
                            setRentalForm(prev => ({
                              ...prev,
                              service_fee_value: Math.max(0, value),
                              service_fee_amount: Math.max(0, value)
                            }));
                          }
                        }}
                        onBlur={(e) => {
                          const value = parseFloat(e.target.value);
                          const finalValue = isNaN(value) ? 0 : Math.max(0, value);
                          setRentalForm(prev => ({
                            ...prev,
                            service_fee_value: finalValue,
                            service_fee_amount: finalValue
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

              {canEditSettings('rental') && (
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
              )}
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
                        type="text"
                        inputMode="decimal"
                        value={rentalForm.global_deposit_amount ?? ''}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^0-9.]/g, '');
                          if (rawValue === '' || rawValue === '.') {
                            setRentalForm(prev => ({ ...prev, global_deposit_amount: rawValue as any }));
                          } else {
                            setRentalForm(prev => ({ ...prev, global_deposit_amount: Math.max(0, parseFloat(rawValue) || 0) }));
                          }
                        }}
                        onBlur={(e) => {
                          const value = parseFloat(e.target.value);
                          setRentalForm(prev => ({ ...prev, global_deposit_amount: isNaN(value) ? 0 : Math.max(0, value) }));
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

              {canEditSettings('rental') && (
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
              )}
            </CardContent>
          </Card>

          {/* Installment Payments Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-primary" />
                Installment Payments
              </CardTitle>
              <CardDescription>
                Allow customers to split rental payments into scheduled installments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Enable Installments Toggle */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">Enable Installment Payments</h4>
                  <p className="text-sm text-muted-foreground">
                    Let customers pay rental costs in weekly or monthly installments
                  </p>
                </div>
                <Switch
                  checked={rentalForm.installments_enabled ?? false}
                  onCheckedChange={(checked) => {
                    setRentalForm(prev => ({ ...prev, installments_enabled: checked }));
                  }}
                />
              </div>

              {rentalForm.installments_enabled && (
                <div className="space-y-6 p-4 border rounded-lg bg-muted/30">
                  <h4 className="font-medium text-sm">Installment Configuration</h4>

                  {/* Weekly Installments */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Weekly Installments</Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="min_days_weekly" className="text-xs text-muted-foreground">
                          Minimum rental days
                        </Label>
                        <Input
                          id="min_days_weekly"
                          type="number"
                          min="7"
                          value={rentalForm.installment_config?.min_days_for_weekly ?? 7}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 7;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                min_days_for_weekly: value,
                              }
                            }));
                          }}
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max_weekly" className="text-xs text-muted-foreground">
                          Maximum installments
                        </Label>
                        <Input
                          id="max_weekly"
                          type="number"
                          min="2"
                          max="12"
                          value={rentalForm.installment_config?.max_installments_weekly ?? 4}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 4;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                max_installments_weekly: Math.min(12, Math.max(2, value)),
                              }
                            }));
                          }}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Monthly Installments */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Monthly Installments</Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="min_days_monthly" className="text-xs text-muted-foreground">
                          Minimum rental days
                        </Label>
                        <Input
                          id="min_days_monthly"
                          type="number"
                          min="30"
                          value={rentalForm.installment_config?.min_days_for_monthly ?? 30}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 30;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                min_days_for_monthly: value,
                              }
                            }));
                          }}
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max_monthly" className="text-xs text-muted-foreground">
                          Maximum installments
                        </Label>
                        <Input
                          id="max_monthly"
                          type="number"
                          min="2"
                          max="12"
                          value={rentalForm.installment_config?.max_installments_monthly ?? 6}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 6;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                max_installments_monthly: Math.min(12, Math.max(2, value)),
                              }
                            }));
                          }}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  {/* Charge First Installment Upfront */}
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">Charge First Installment Upfront</Label>
                      <p className="text-xs text-muted-foreground">
                        Collect the first installment at checkout along with deposit and fees
                      </p>
                    </div>
                    <Switch
                      checked={rentalForm.installment_config?.charge_first_upfront ?? true}
                      onCheckedChange={(checked) => {
                        setRentalForm(prev => ({
                          ...prev,
                          installment_config: {
                            ...prev.installment_config,
                            charge_first_upfront: checked,
                          }
                        }));
                      }}
                    />
                  </div>

                  {/* What Gets Split */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">What Gets Split Into Installments</Label>
                    <RadioGroup
                      value={rentalForm.installment_config?.what_gets_split ?? 'rental_tax'}
                      onValueChange={(value: 'rental_only' | 'rental_tax' | 'rental_tax_extras') => {
                        setRentalForm(prev => ({
                          ...prev,
                          installment_config: {
                            ...prev.installment_config,
                            what_gets_split: value,
                          }
                        }));
                      }}
                      className="space-y-2"
                    >
                      <div className="flex items-center space-x-2 p-2 border rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value="rental_only" id="split_rental" />
                        <Label htmlFor="split_rental" className="flex-1 cursor-pointer">
                          <span className="font-medium">Rental Only</span>
                          <p className="text-xs text-muted-foreground">Only the base rental cost is split; tax paid upfront</p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2 p-2 border rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value="rental_tax" id="split_rental_tax" />
                        <Label htmlFor="split_rental_tax" className="flex-1 cursor-pointer">
                          <span className="font-medium">Rental + Tax</span>
                          <p className="text-xs text-muted-foreground">Rental cost and applicable taxes are split into installments</p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2 p-2 border rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value="rental_tax_extras" id="split_all" />
                        <Label htmlFor="split_all" className="flex-1 cursor-pointer">
                          <span className="font-medium">Rental + Tax + Extras</span>
                          <p className="text-xs text-muted-foreground">Include delivery/collection fees and extras in installments</p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <Separator className="my-4" />

                  {/* Failed Payment Recovery */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Failed Payment Recovery</Label>
                    <p className="text-xs text-muted-foreground">
                      Configure how the system handles failed installment payments
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="grace_period" className="text-xs text-muted-foreground">
                          Grace Period (days)
                        </Label>
                        <Input
                          id="grace_period"
                          type="number"
                          min="0"
                          max="14"
                          value={rentalForm.installment_config?.grace_period_days ?? 3}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 3;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                grace_period_days: Math.min(14, Math.max(0, value)),
                              }
                            }));
                          }}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">Days before marking overdue</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max_retries" className="text-xs text-muted-foreground">
                          Max Retry Attempts
                        </Label>
                        <Input
                          id="max_retries"
                          type="number"
                          min="1"
                          max="10"
                          value={rentalForm.installment_config?.max_retry_attempts ?? 3}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 3;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                max_retry_attempts: Math.min(10, Math.max(1, value)),
                              }
                            }));
                          }}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">Attempts before giving up</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retry_interval" className="text-xs text-muted-foreground">
                          Retry Interval (days)
                        </Label>
                        <Input
                          id="retry_interval"
                          type="number"
                          min="1"
                          max="7"
                          value={rentalForm.installment_config?.retry_interval_days ?? 1}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || 1;
                            setRentalForm(prev => ({
                              ...prev,
                              installment_config: {
                                ...prev.installment_config,
                                retry_interval_days: Math.min(7, Math.max(1, value)),
                              }
                            }));
                          }}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">Days between retries</p>
                      </div>
                    </div>
                  </div>

                  <Alert>
                    <AlertDescription>
                      <strong>How it works:</strong> Customers pay the security deposit and service fee upfront
                      {rentalForm.installment_config?.charge_first_upfront && ', plus the first installment'}.
                      The {rentalForm.installment_config?.what_gets_split === 'rental_only' ? 'rental cost' :
                           rentalForm.installment_config?.what_gets_split === 'rental_tax' ? 'rental cost + tax' :
                           'rental cost, tax, and extras'} is split into scheduled payments charged automatically to their saved card.
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {canEditSettings('rental') && (
                <Button
                  onClick={async () => {
                    try {
                      await updateRentalSettings({
                        installments_enabled: rentalForm.installments_enabled,
                        installment_config: rentalForm.installment_config,
                      });
                    } catch (error) {
                      console.error('Failed to update installment settings:', error);
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
                  Save Installment Settings
                </Button>
              )}
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
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/[^0-9.]/g, '');
                      setPromoForm(prev => ({ ...prev, value: rawValue }));
                    }}
                    type="text"
                    inputMode="decimal"
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
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 100"
                  className="max-w-md"
                  value={promoForm.max_users}
                  onChange={(e) => {
                    const rawValue = e.target.value.replace(/[^0-9]/g, '');
                    setPromoForm(prev => ({ ...prev, max_users: rawValue }));
                  }}
                />
              </div>

              {/* Add Button */}
              {canEditSettings('rental') && (
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
              )}

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
                                {promo.type === 'percentage' ? `${promo.value}%` : formatCurrency(Number(promo.value), tenant?.currency_code || 'USD')}
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
                      <Popover modal={true}>
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
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={editingPromo.max_users}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^0-9]/g, '');
                          setEditingPromo({ ...editingPromo, max_users: rawValue });
                        }}
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
                        type="text"
                        inputMode="decimal"
                        value={editingPromo.value}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^0-9.]/g, '');
                          setEditingPromo({ ...editingPromo, value: rawValue });
                        }}
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

          {/* Lockbox Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Lockbox
              </CardTitle>
              <CardDescription>
                Enable lockbox-based key handover for delivery rentals. When enabled, staff can place keys in a lockbox and the code is sent to the customer automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Enable Toggle */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">Enable Lockbox</h4>
                  <p className="text-sm text-muted-foreground">
                    Allow lockbox as a key handover method for delivery rentals
                  </p>
                </div>
                <Switch
                  checked={rentalForm.lockbox_enabled}
                  onCheckedChange={(checked) => {
                    setRentalForm(prev => ({ ...prev, lockbox_enabled: checked }));
                  }}
                />
              </div>

              {rentalForm.lockbox_enabled && (
                <div className="space-y-6">
                  {/* Code Length */}
                  <div className="space-y-2">
                    <Label>Code Length</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      placeholder="Leave empty for free length"
                      value={rentalForm.lockbox_code_length ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRentalForm(prev => ({
                          ...prev,
                          lockbox_code_length: val ? parseInt(val) : null,
                        }));
                      }}
                      className="w-48"
                    />
                    <p className="text-xs text-muted-foreground">
                      {rentalForm.lockbox_code_length
                        ? `Generate button will create random ${rentalForm.lockbox_code_length}-digit codes on vehicle forms`
                        : 'Free length — staff can enter any code, generate button creates a random 4-digit code'}
                    </p>
                  </div>

                  {/* Notification Methods */}
                  <div className="space-y-3">
                    <Label>Notification Methods</Label>
                    <p className="text-xs text-muted-foreground">
                      How should customers receive the lockbox code when a vehicle is delivered?
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Email</span>
                        </div>
                        <Switch
                          checked={rentalForm.lockbox_notification_methods.includes('email')}
                          onCheckedChange={(checked) => {
                            setRentalForm(prev => ({
                              ...prev,
                              lockbox_notification_methods: checked
                                ? [...prev.lockbox_notification_methods.filter(m => m !== 'email'), 'email']
                                : prev.lockbox_notification_methods.filter(m => m !== 'email'),
                            }));
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.612l4.458-1.495A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.319 0-4.476-.67-6.313-1.822l-.44-.264-2.645.887.887-2.645-.264-.44A9.952 9.952 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
                          <span className="text-sm font-medium">WhatsApp</span>
                        </div>
                        <Switch
                          checked={rentalForm.lockbox_notification_methods.includes('whatsapp')}
                          onCheckedChange={(checked) => {
                            setRentalForm(prev => ({
                              ...prev,
                              lockbox_notification_methods: checked
                                ? [...prev.lockbox_notification_methods.filter(m => m !== 'whatsapp'), 'whatsapp']
                                : prev.lockbox_notification_methods.filter(m => m !== 'whatsapp'),
                            }));
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Bell className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">SMS</span>
                        </div>
                        <Switch
                          checked={rentalForm.lockbox_notification_methods.includes('sms')}
                          onCheckedChange={(checked) => {
                            setRentalForm(prev => ({
                              ...prev,
                              lockbox_notification_methods: checked
                                ? [...prev.lockbox_notification_methods.filter(m => m !== 'sms'), 'sms']
                                : prev.lockbox_notification_methods.filter(m => m !== 'sms'),
                            }));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Save Button */}
              {canEditSettings('rental') && (
                <Button
                  onClick={async () => {
                    try {
                      await updateRentalSettings({
                        lockbox_enabled: rentalForm.lockbox_enabled,
                        lockbox_code_length: rentalForm.lockbox_code_length,
                        lockbox_notification_methods: rentalForm.lockbox_notification_methods as any,
                      });
                    } catch (error) {
                      console.error('Failed to update lockbox settings:', error);
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
              )}
            </CardContent>
          </Card>

        </TabsContent>

        {/* Dynamic Pricing Tab */}
        <TabsContent value="pricing" className="space-y-6">
          <PricingRulesSettings onDirtyChange={setPricingDirty} />
        </TabsContent>

        {/* Extras Tab */}
        <TabsContent value="extras" className="space-y-6">
          <ExtrasSettings />
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-6">
          {/* Agreement Templates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FilePenLine className="h-5 w-5 text-primary" />
                Agreement Templates
              </CardTitle>
              <CardDescription>
                Customize the rental agreement template used for electronic signing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Create and manage agreement templates that will be used when sending rental contracts for electronic signing.
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

          {/* Lockbox Notification Templates */}
          <LockboxTemplatesSection />
        </TabsContent>

        {/* Integrations Tab (Bonzah + Blacklist) */}
        <TabsContent value="integrations" className="space-y-6">
          <BonzahSettings />

          {/* Global Blacklist */}
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

        {/* Subscription Tab */}
        <TabsContent value="subscription" className="space-y-6">
          <SubscriptionSettings />
        </TabsContent>

            </div>
          </div>{/* end Tab Content Area */}
        </div>{/* end flex layout */}
      </Tabs>

      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        onCancel={cancelLeave}
        onDiscard={confirmLeave}
        onSave={saveAndLeave}
        isSaving={isSavingNav}
      />

      <UnsavedChangesDialog
        open={showTabWarning}
        onCancel={handleTabCancel}
        onDiscard={handleTabDiscardAndSwitch}
        onSave={handleTabSaveAndSwitch}
        isSaving={isSavingForTab}
      />

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
