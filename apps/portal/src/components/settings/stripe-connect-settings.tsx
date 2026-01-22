'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link2, CheckCircle2, AlertCircle, ExternalLink, Loader2, RefreshCw, Copy, TestTube2, Zap } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface StripeConnectStatus {
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  stripe_account_status: string | null;
  stripe_mode: 'test' | 'live';
}

export function StripeConnectSettings() {
  const queryClient = useQueryClient();
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [showModeWarning, setShowModeWarning] = useState(false);
  const [pendingMode, setPendingMode] = useState<'test' | 'live' | null>(null);
  const { tenant: tenantContext } = useTenant();

  // Get current tenant's Stripe Connect status
  const { data: tenantStatus, isLoading } = useQuery({
    queryKey: ['tenant-stripe-status', tenantContext?.id],
    queryFn: async () => {
      if (!tenantContext?.id) throw new Error('No tenant context');

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id, stripe_account_id, stripe_onboarding_complete, stripe_account_status, stripe_mode, company_name, contact_email')
        .eq('id', tenantContext.id)
        .single();

      if (tenantError) throw tenantError;
      return tenant;
    },
    enabled: !!tenantContext?.id,
  });

  // Generate onboarding link mutation
  const generateLinkMutation = useMutation({
    mutationFn: async () => {
      if (!tenantStatus?.id) throw new Error('Tenant not found');

      // If no Stripe account exists, create one first
      if (!tenantStatus.stripe_account_id) {
        const { data, error } = await supabase.functions.invoke('create-connected-account', {
          body: {
            tenantId: tenantStatus.id,
            email: tenantStatus.contact_email || `admin@${tenantStatus.company_name?.toLowerCase().replace(/\s+/g, '')}.com`,
            businessName: tenantStatus.company_name,
          },
        });

        if (error) throw error;
        return data;
      }

      // Otherwise just get a new onboarding link
      const { data, error } = await supabase.functions.invoke('get-connect-onboarding-link', {
        body: {
          tenantId: tenantStatus.id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.onboardingUrl) {
        // Navigate in same tab to avoid popup blocker
        window.location.href = data.onboardingUrl;
      }
      queryClient.invalidateQueries({ queryKey: ['tenant-stripe-status'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate onboarding link',
        variant: 'destructive',
      });
    },
  });

  const handleGenerateLink = async () => {
    setIsGeneratingLink(true);
    try {
      await generateLinkMutation.mutateAsync();
    } finally {
      setIsGeneratingLink(false);
    }
  };

  // Update Stripe mode mutation
  const updateStripeMutation = useMutation({
    mutationFn: async (newMode: 'test' | 'live') => {
      if (!tenantStatus?.id) throw new Error('Tenant not found');

      // Note: Onboarding check removed to allow mode switching for testing
      // Live mode will work with platform keys if Connect is not set up

      const { error } = await supabase
        .from('tenants')
        .update({ stripe_mode: newMode })
        .eq('id', tenantStatus.id);

      if (error) throw error;
      return newMode;
    },
    onSuccess: (newMode) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-stripe-status'] });
      toast({
        title: 'Stripe Mode Updated',
        description: `Successfully switched to ${newMode} mode. ${
          newMode === 'live'
            ? 'All new payments will use live Stripe keys and charge real money.'
            : 'All new payments will use test Stripe keys with test cards only.'
        }`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update Stripe mode',
        variant: 'destructive',
      });
    },
  });

  const handleModeToggle = (newMode: 'test' | 'live') => {
    // Show warning dialog - onboarding check removed to allow mode switching
    // If Connect is not set up, payments will process on platform account
    setPendingMode(newMode);
    setShowModeWarning(true);
  };

  const confirmModeSwitch = async () => {
    if (pendingMode) {
      await updateStripeMutation.mutateAsync(pendingMode);
    }
    setShowModeWarning(false);
    setPendingMode(null);
  };

  const copyAccountId = () => {
    if (tenantStatus?.stripe_account_id) {
      navigator.clipboard.writeText(tenantStatus.stripe_account_id);
      toast({
        title: 'Copied',
        description: 'Stripe Account ID copied to clipboard',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading Stripe Connect status...</span>
        </CardContent>
      </Card>
    );
  }

  const isConnected = tenantStatus?.stripe_onboarding_complete && tenantStatus?.stripe_account_status === 'active';
  const isPending = tenantStatus?.stripe_account_id && !tenantStatus?.stripe_onboarding_complete;
  const isRestricted = tenantStatus?.stripe_account_status === 'restricted';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" />
          Stripe Connect
        </CardTitle>
        <CardDescription>
          Connect your Stripe account to receive payments directly to your bank account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stripe Mode Toggle */}
        <div className="p-4 rounded-lg border bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 dark:from-blue-950/30 dark:to-purple-950/30 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h4 className="font-medium flex items-center gap-2">
                {tenantStatus?.stripe_mode === 'live' ? (
                  <>
                    <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="dark:text-white">Live Mode</span>
                    <Badge className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600">LIVE</Badge>
                  </>
                ) : (
                  <>
                    <TestTube2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="dark:text-white">Test Mode</span>
                    <Badge className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600">TEST</Badge>
                  </>
                )}
              </h4>
              <p className="text-sm text-muted-foreground mt-1 dark:text-gray-300">
                {tenantStatus?.stripe_mode === 'live'
                  ? 'Accepting real payments with live Stripe keys'
                  : 'Using test Stripe keys - only test cards accepted (4242 4242 4242 4242)'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant={tenantStatus?.stripe_mode === 'test' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleModeToggle('test')}
                disabled={tenantStatus?.stripe_mode === 'test' || updateStripeMutation.isPending}
                className={tenantStatus?.stripe_mode === 'test' ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600' : 'dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}
              >
                <TestTube2 className="h-4 w-4 mr-1" />
                Test
              </Button>
              <Button
                variant={tenantStatus?.stripe_mode === 'live' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleModeToggle('live')}
                disabled={tenantStatus?.stripe_mode === 'live' || updateStripeMutation.isPending}
                className={tenantStatus?.stripe_mode === 'live' ? 'bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600' : 'dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}
              >
                <Zap className="h-4 w-4 mr-1" />
                Live
              </Button>
            </div>
          </div>
        </div>

        {/* Status Display */}
        <div className={`p-4 rounded-lg border ${
          isConnected
            ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
            : isPending
            ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800'
            : isRestricted
            ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
            : 'bg-gray-50 border-gray-200 dark:bg-gray-900/50 dark:border-gray-700'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isConnected
                ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
                : isPending
                ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50 dark:text-yellow-400'
                : isRestricted
                ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {isConnected ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className={`font-medium ${
                  isConnected
                    ? 'text-green-800 dark:text-green-300'
                    : isPending
                    ? 'text-yellow-800 dark:text-yellow-300'
                    : isRestricted
                    ? 'text-red-800 dark:text-red-300'
                    : 'text-gray-800 dark:text-gray-300'
                }`}>
                  {isConnected
                    ? 'Stripe Connected'
                    : isPending
                    ? 'Onboarding Incomplete'
                    : isRestricted
                    ? 'Account Restricted'
                    : 'Not Connected'
                  }
                </h4>
                <Badge variant={isConnected ? 'default' : isPending ? 'secondary' : 'destructive'}>
                  {tenantStatus?.stripe_account_status || 'Not Set Up'}
                </Badge>
              </div>
              <p className={`text-sm mt-1 ${
                isConnected
                  ? 'text-green-700 dark:text-green-400'
                  : isPending
                  ? 'text-yellow-700 dark:text-yellow-400'
                  : isRestricted
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}>
                {isConnected
                  ? 'Your Stripe account is fully connected. Please wait for confirmation from your platform host to proceed with payments.'
                  : isPending
                  ? 'Please complete the Stripe onboarding process to start receiving payments.'
                  : isRestricted
                  ? 'Your Stripe account has restrictions. Please contact Stripe support or complete additional verification.'
                  : 'Set up Stripe Connect to receive payments directly to your bank account.'
                }
              </p>
            </div>
          </div>
        </div>

        {/* Account Details */}
        {tenantStatus?.stripe_account_id && (
          <div className="space-y-3">
            <h4 className="font-medium dark:text-white">Account Details</h4>
            <div className="grid gap-3">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg dark:bg-gray-900/50 dark:border dark:border-gray-800">
                <div>
                  <p className="text-sm text-muted-foreground dark:text-gray-400">Account ID</p>
                  <p className="font-mono text-sm dark:text-gray-200">{tenantStatus.stripe_account_id}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={copyAccountId} className="dark:hover:bg-gray-800">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg dark:bg-gray-900/50 dark:border dark:border-gray-800">
                <div>
                  <p className="text-sm text-muted-foreground dark:text-gray-400">Payouts</p>
                  <p className="font-medium dark:text-gray-200">{isConnected ? 'Enabled' : 'Disabled'}</p>
                </div>
                {isConnected && (
                  <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400">Active</Badge>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          {!isConnected && (
            <Button
              onClick={handleGenerateLink}
              disabled={isGeneratingLink}
            >
              {isGeneratingLink ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : tenantStatus?.stripe_account_id ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Complete Onboarding
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  Set Up Stripe Connect
                </>
              )}
            </Button>
          )}

          {isConnected && (
            <Button
              variant="outline"
              onClick={() => window.open('https://dashboard.stripe.com/connect/accounts/overview', '_blank')}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              View Stripe Dashboard
            </Button>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-muted/50 p-4 rounded-lg dark:bg-gray-900/50 dark:border dark:border-gray-800">
          <h4 className="font-medium mb-2 dark:text-white">How Stripe Connect Works</h4>
          <ul className="text-sm text-muted-foreground dark:text-gray-300 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-primary dark:text-blue-400 mt-0.5">1.</span>
              <span>Click "Set Up Stripe Connect" to begin the onboarding process</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary dark:text-blue-400 mt-0.5">2.</span>
              <span>Complete Stripe's verification (business info, bank account, ID)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary dark:text-blue-400 mt-0.5">3.</span>
              <span>Once verified, customer payments go directly to your bank account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary dark:text-blue-400 mt-0.5">4.</span>
              <span>Stripe handles payouts automatically on your schedule</span>
            </li>
          </ul>
        </div>
      </CardContent>

      {/* Mode Switch Warning Dialog */}
      <AlertDialog open={showModeWarning} onOpenChange={setShowModeWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pendingMode === 'live' ? (
                <>
                  <Zap className="h-5 w-5 text-yellow-600" />
                  Switch to Live Mode?
                </>
              ) : (
                <>
                  <TestTube2 className="h-5 w-5 text-blue-600" />
                  Switch to Test Mode?
                </>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3 pt-2">
                {pendingMode === 'live' ? (
                  <>
                    <div className="font-medium text-yellow-700 dark:text-yellow-500">
                      ⚠️ Warning: This will enable REAL payments
                    </div>
                    <div>
                      By switching to live mode, all new bookings will:
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Use your live Stripe Connect account</li>
                      <li>Accept real credit cards</li>
                      <li>Charge real money to customers</li>
                      <li>Deposit funds to your bank account</li>
                    </ul>
                    <div className="text-sm font-medium text-red-600 dark:text-red-500">
                      Make sure you have completed all testing before switching to live mode.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium text-blue-700 dark:text-blue-500">
                      Switching back to test mode
                    </div>
                    <div>
                      By switching to test mode, all new bookings will:
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Use test Stripe keys</li>
                      <li>Only accept test cards (4242 4242 4242 4242)</li>
                      <li>Route to a shared test Connect account</li>
                      <li>Not process any real money</li>
                    </ul>
                    <div className="text-sm text-muted-foreground">
                      Existing live bookings will not be affected.
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMode(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmModeSwitch}
              className={pendingMode === 'live' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}
            >
              {updateStripeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Switching...
                </>
              ) : (
                <>
                  Yes, Switch to {pendingMode === 'live' ? 'Live' : 'Test'} Mode
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default StripeConnectSettings;
