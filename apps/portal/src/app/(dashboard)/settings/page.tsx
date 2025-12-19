'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Settings as SettingsIcon, Building2, Bell, Zap, Upload, Save, Loader2, Database, AlertTriangle, Trash2, CreditCard, Palette } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { LogoUploadWithResize } from '@/components/settings/logo-upload-with-resize';
import { FaviconUpload } from '@/components/settings/favicon-upload';
import { DataCleanupDialog } from '@/components/settings/data-cleanup-dialog';
import ReminderRulesConfig from '@/components/settings/reminder-rules-config';
import { ColorPicker } from '@/components/settings/color-picker';
import { Textarea } from '@/components/ui/textarea';
import { OGImageUpload } from '@/components/settings/og-image-upload';

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

  // Use tenant branding hook for multi-tenant branding updates
  const {
    branding: tenantBranding,
    updateBranding: updateTenantBranding,
    isUpdating: isUpdatingTenantBranding
  } = useTenantBranding();

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['branding', 'reminders', 'payments', 'users'].includes(tabParam)) {
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
        <TabsList className="grid w-full grid-cols-4">
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
          <TabsTrigger value="users" className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Users</span>
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
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      style={{ backgroundColor: brandingForm.light_primary_color || brandingForm.primary_color }}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-4 py-2 text-white hover:opacity-90 transition-opacity"
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
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-4 py-2 border-2 hover:opacity-90 transition-opacity"
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
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      style={{ backgroundColor: brandingForm.dark_primary_color || brandingForm.primary_color }}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-4 py-2 text-white hover:opacity-90 transition-opacity"
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
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-4 py-2 border-2 hover:opacity-90 transition-opacity"
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
          <div className="flex justify-between items-center">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10">
                  Reset All to Defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Branding to Defaults?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will reset all branding settings to their original values:
                    <ul className="mt-2 text-sm list-disc list-inside space-y-1">
                      <li>App Name: "Drive 917"</li>
                      <li>Primary Color: Gold (#C6A256)</li>
                      <li>Secondary & Accent: Gold (#C6A256)</li>
                      <li>Background Colors: Theme defaults</li>
                      <li>SEO settings: Default values</li>
                    </ul>
                  </AlertDialogDescription>
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
              className="min-w-[120px]"
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
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Payment Due Today</h4>
                      <Badge variant="secondary" className="text-xs">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders for payments due today
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_due_today ?? true}
                    onCheckedChange={() => toggleReminder('reminder_due_today')}
                    disabled={isUpdating}
                  />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Payment Overdue (1 Day)</h4>
                      <Badge variant="secondary" className="text-xs">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders 1 day after payment due date
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_overdue_1d ?? true}
                    onCheckedChange={() => toggleReminder('reminder_overdue_1d')}
                    disabled={isUpdating}
                  />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Payment Overdue (Multiple Days)</h4>
                      <Badge variant="secondary" className="text-xs">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders for payments overdue by multiple days
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_overdue_multi ?? true}
                    onCheckedChange={() => toggleReminder('reminder_overdue_multi')}
                    disabled={isUpdating}
                  />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Payment Due Soon (2 Days)</h4>
                      <Badge variant="secondary" className="text-xs">In-App Only</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Send reminders 2 days before payment due date
                    </p>
                  </div>
                  <Switch
                    checked={settings?.reminder_due_soon_2d ?? false}
                    onCheckedChange={() => toggleReminder('reminder_due_soon_2d')}
                    disabled={isUpdating}
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
                    className={`flex-1 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      settings?.payment_mode === 'automated'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setPaymentMode('automated')}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${
                        settings?.payment_mode === 'automated'
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
                    className={`flex-1 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      settings?.payment_mode === 'manual'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setPaymentMode('manual')}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${
                        settings?.payment_mode === 'manual'
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
                <div className={`p-4 rounded-lg ${
                  settings?.payment_mode === 'manual'
                    ? 'bg-orange-50 border border-orange-200'
                    : 'bg-green-50 border border-green-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      settings?.payment_mode === 'manual'
                        ? 'bg-orange-100 text-orange-600'
                        : 'bg-green-100 text-green-600'
                    }`}>
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className={`font-medium ${
                        settings?.payment_mode === 'manual'
                          ? 'text-orange-800'
                          : 'text-green-800'
                      }`}>
                        {settings?.payment_mode === 'manual'
                          ? 'Manual Approval is Active'
                          : 'Automated Processing is Active'
                        }
                      </h4>
                      <p className={`text-sm mt-1 ${
                        settings?.payment_mode === 'manual'
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

      {/* Users Tab - Moved to separate page */}
      <TabsContent value="users">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <h3 className="text-lg font-medium mb-2">Users Management</h3>
          <p className="text-muted-foreground mb-4">
            User management has been moved to a dedicated page.
          </p>
          <Button onClick={() => router.push('/settings/users')}>
            Go to Users Management
          </Button>
        </div>
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
