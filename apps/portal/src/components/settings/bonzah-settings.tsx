'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Shield, CheckCircle2, AlertCircle, ExternalLink, Loader2, TestTube2, Zap, Unplug, Lock, Wallet, RefreshCw, Bell, ShieldAlert, ArrowRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { useBonzahBalance } from '@/hooks/use-bonzah-balance';
import { useBonzahAlertConfig } from '@/hooks/use-bonzah-alert-config';
import { useBonzahRetryAll } from '@/hooks/use-bonzah-retry-all';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface BonzahStatus {
  bonzah_mode: 'test' | 'live';
  bonzah_username: string | null;
  bonzah_password: string | null;
  integration_bonzah: boolean;
}

export function BonzahSettings() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { tenant: tenantContext, refetchTenant } = useTenant();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);

  // Shared balance hook
  const { balanceNumber, refetch: refetchBalance, isFetching: isRefreshingBalance, portalUrl } = useBonzahBalance();

  // Alert config hook
  const { config: alertConfig, updateConfig } = useBonzahAlertConfig();

  // Retry all hook
  const { retryAll, progress: retryProgress } = useBonzahRetryAll();

  // Pending policies query
  const { data: pendingPolicies } = useQuery({
    queryKey: ['bonzah-pending-policies', tenantContext?.id],
    queryFn: async () => {
      if (!tenantContext?.id) throw new Error('No tenant');
      const { data, error } = await supabase
        .from('bonzah_insurance_policies')
        .select('id, rental_id, premium_amount, status')
        .eq('tenant_id', tenantContext.id)
        .eq('status', 'insufficient_balance');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantContext?.id,
  });

  // Alert dialog state
  const [showAlertDialog, setShowAlertDialog] = useState(false);
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState('');

  // Sync dialog form state when opening
  useEffect(() => {
    if (showAlertDialog) {
      setAlertEnabled(alertConfig?.enabled ?? false);
      setAlertThreshold(alertConfig?.threshold?.toString() ?? '');
    }
  }, [showAlertDialog, alertConfig]);

  // Fetch current Bonzah status — staleTime: 0 so mode changes from admin are picked up on mount
  const { data: bonzahStatus, isLoading } = useQuery({
    queryKey: ['tenant-bonzah-status', tenantContext?.id],
    queryFn: async () => {
      if (!tenantContext?.id) throw new Error('No tenant context');

      const { data, error } = await supabase
        .from('tenants')
        .select('bonzah_mode, bonzah_username, bonzah_password, integration_bonzah')
        .eq('id', tenantContext.id)
        .single();

      if (error) throw error;

      // Pre-fill form fields
      if (data?.bonzah_username) setUsername(data.bonzah_username);
      if (data?.bonzah_password) setPassword(data.bonzah_password);

      return data as BonzahStatus;
    },
    enabled: !!tenantContext?.id,
    staleTime: 0,
  });

  // Verify & connect mutation
  const handleVerifyAndConnect = async () => {
    if (!tenantContext?.id || !username || !password) return;

    setIsVerifying(true);
    try {
      // Mode is resolved server-side from the DB via tenantId
      const { data, error } = await supabase.functions.invoke('bonzah-verify-credentials', {
        body: { username, password, tenantId: tenantContext.id },
      });

      if (error) throw error;

      if (!data?.valid) {
        toast({
          title: 'Verification Failed',
          description: data?.error || 'Invalid Bonzah credentials. Please check and try again.',
          variant: 'destructive',
        });
        return;
      }

      // Credentials valid — save to database
      const { error: updateError } = await supabase
        .from('tenants')
        .update({
          bonzah_username: username,
          bonzah_password: password,
          integration_bonzah: true,
        })
        .eq('id', tenantContext.id);

      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['tenant-bonzah-status'] });
      refetchTenant();
      toast({
        title: 'Bonzah Connected',
        description: 'Your Bonzah credentials have been verified and saved. Insurance is now enabled for your customers.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to verify credentials',
        variant: 'destructive',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  // Disconnect mutation
  const handleDisconnect = async () => {
    if (!tenantContext?.id) return;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          bonzah_username: null,
          bonzah_password: null,
          integration_bonzah: false,
        })
        .eq('id', tenantContext.id);

      if (error) throw error;

      setUsername('');
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['tenant-bonzah-status'] });
      refetchTenant();
      toast({
        title: 'Bonzah Disconnected',
        description: 'Bonzah credentials have been removed. Insurance will no longer be shown to customers during booking.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to disconnect',
        variant: 'destructive',
      });
    }
    setShowDisconnectWarning(false);
  };

  // Save alert config
  const handleSaveAlert = async () => {
    const threshold = parseFloat(alertThreshold);
    if (alertEnabled && (isNaN(threshold) || threshold <= 0)) {
      toast({
        title: 'Invalid threshold',
        description: 'Please enter a valid dollar amount greater than 0.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updateConfig.mutateAsync({
        enabled: alertEnabled,
        threshold: alertEnabled ? threshold : (alertConfig?.threshold ?? 0),
      });
      toast({
        title: 'Alert settings saved',
        description: alertEnabled
          ? `You'll be notified when your balance drops below $${threshold.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`
          : 'Low balance alerts have been disabled.',
      });
      setShowAlertDialog(false);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save alert settings',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading Bonzah status...</span>
        </CardContent>
      </Card>
    );
  }

  const isConnected = bonzahStatus?.integration_bonzah && !!bonzahStatus?.bonzah_username;
  const currentMode = tenantContext?.bonzah_mode || bonzahStatus?.bonzah_mode || 'test';
  const pendingCount = pendingPolicies?.length || 0;
  const pendingTotal = pendingPolicies?.reduce((sum, p) => sum + (p.premium_amount || 0), 0) || 0;

  return (
    <div className="space-y-6">
      {/* Card 1: How Bonzah Insurance Works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            How Bonzah Insurance Works
          </CardTitle>
          <CardDescription>
            Offer rental car insurance to your customers through Bonzah
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 p-4 rounded-lg dark:bg-gray-900/50 dark:border dark:border-gray-800">
            <ul className="text-sm text-muted-foreground dark:text-gray-300 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary dark:text-blue-400 mt-0.5 font-medium">1.</span>
                <span>Complete the Bonzah onboarding form below to register your company with Bonzah</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary dark:text-blue-400 mt-0.5 font-medium">2.</span>
                <span>After approval, you'll receive Bonzah portal credentials (email & password)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary dark:text-blue-400 mt-0.5 font-medium">3.</span>
                <span>Enter those credentials below and click "Verify & Connect"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary dark:text-blue-400 mt-0.5 font-medium">4.</span>
                <span>Once connected, your customers will see insurance options during the booking process (Step 3 of the booking widget)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary dark:text-blue-400 mt-0.5 font-medium">5.</span>
                <span>Insurance premiums are included at checkout — customers pay you through your Stripe Connect account</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary dark:text-blue-400 mt-0.5 font-medium">6.</span>
                <span>At the end of each month, Bonzah sends you an invoice for the insurance premiums, which you pay directly to Bonzah</span>
              </li>
            </ul>
            <div className="mt-4 pt-3 border-t">
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                <ExternalLink className="h-4 w-4" />
                Open Bonzah Portal ({currentMode === 'live' ? 'Production' : 'Sandbox'})
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: API Mode */}
      <Card>
        <CardHeader>
          <CardTitle>API Mode</CardTitle>
          <CardDescription>
            Current Bonzah API environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg border bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 dark:from-blue-950/30 dark:to-purple-950/30 dark:border-blue-800">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h4 className="font-medium flex items-center gap-2">
                  {currentMode === 'live' ? (
                    <>
                      <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <span className="dark:text-white">Live Mode</span>
                    </>
                  ) : (
                    <>
                      <TestTube2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span className="dark:text-white">Test Mode (Setup Phase)</span>
                    </>
                  )}
                </h4>
                <p className="text-sm text-muted-foreground mt-1 dark:text-gray-300">
                  Live mode is enabled by Drive247
                </p>
              </div>
              {currentMode === 'live' ? (
                <Badge className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 shrink-0">LIVE</Badge>
              ) : (
                <Badge className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 shrink-0">TEST</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Bonzah Credentials
            {isConnected ? (
              <Badge className="bg-green-600 hover:bg-green-700">Connected</Badge>
            ) : (
              <Badge variant="secondary">Not Connected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Enter your Bonzah portal credentials to enable insurance for your customers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className={`p-4 rounded-lg border ${
            isConnected
              ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
              : 'bg-gray-50 border-gray-200 dark:bg-gray-900/50 dark:border-gray-700'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isConnected
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {isConnected ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
              </div>
              <div>
                <h4 className={`font-medium ${
                  isConnected
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-gray-800 dark:text-gray-300'
                }`}>
                  {isConnected ? 'Bonzah Connected' : 'Not Connected'}
                </h4>
                <p className={`text-sm mt-1 ${
                  isConnected
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {isConnected
                    ? `Connected as ${bonzahStatus?.bonzah_username}. Insurance is enabled for your customers.`
                    : 'Enter your Bonzah credentials below to enable insurance.'}
                </p>
              </div>
            </div>
          </div>

          {/* Balance Display */}
          {isConnected && (
            <div className="p-4 rounded-lg border bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 dark:from-amber-950/30 dark:to-orange-950/30 dark:border-amber-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                    <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">CD Balance</p>
                    <p className="text-2xl font-bold text-amber-900 dark:text-amber-200">
                      {balanceNumber != null
                        ? `$${balanceNumber.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '---'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="text-amber-700 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50"
                  >
                    <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      Top Up
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => refetchBalance()}
                    disabled={isRefreshingBalance}
                    className="text-amber-700 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshingBalance ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                This is the broker-level CD balance. Policies are issued from your <strong>allocated</strong> balance — allocate funds in the Bonzah portal to activate pending policies.
              </p>

              {/* Pending policies context */}
              {pendingCount > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 text-[#CC004A] mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#CC004A]">
                        {pendingCount} {pendingCount === 1 ? 'policy' : 'policies'} quoted — ${pendingTotal.toFixed(2)} needed to activate
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Allocate at least ${pendingTotal.toFixed(2)} from your CD balance in the Bonzah portal, then retry.
                      </p>
                      {retryProgress.isRetrying && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Retrying... {retryProgress.completed + retryProgress.failed} of {retryProgress.total}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10"
                          disabled={retryProgress.isRetrying}
                          onClick={() => pendingPolicies && retryAll(pendingPolicies)}
                        >
                          {retryProgress.isRetrying ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Retry All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10"
                          onClick={() => router.push('/rentals?bonzahStatus=ins_pending')}
                        >
                          View Rentals
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Low Balance Alert Config */}
          {isConnected && (
            <div className="p-4 rounded-lg border bg-muted/50 dark:bg-gray-900/50 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                    <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Low Balance Alert</p>
                    <p className="text-xs text-muted-foreground">
                      {alertConfig?.enabled
                        ? `Alert when balance drops below $${alertConfig.threshold.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                        : 'No alert configured'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAlertDialog(true)}
                >
                  {alertConfig?.enabled ? 'Edit Alert' : 'Set Alert'}
                </Button>
              </div>
            </div>
          )}

          {/* Credential Form */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="bonzah-email">Email</Label>
              <Input
                id="bonzah-email"
                type="email"
                placeholder="your-bonzah-email@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bonzah-password">Password</Label>
              <Input
                id="bonzah-password"
                type="password"
                placeholder="Your Bonzah password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              These credentials are verified against your current API mode ({currentMode}).
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleVerifyAndConnect}
              disabled={isVerifying || !username || !password}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Verify & Connect
                </>
              )}
            </Button>

            {isConnected && (
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={() => setShowDisconnectWarning(true)}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Onboarding */}
      <Card>
        <CardHeader>
          <CardTitle>Bonzah Onboarding</CardTitle>
          <CardDescription>
            Complete this form to register your rental company with Bonzah and get your credentials
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg overflow-hidden border">
            <iframe
              src="https://api.leadconnectorhq.com/widget/form/3nsZvu171vvOOj7A58WX"
              style={{ width: '100%', height: '800px', border: 'none' }}
              title="Bonzah Onboarding Form"
              allow="clipboard-write"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            Having trouble with the form?{' '}
            <a
              href="https://api.leadconnectorhq.com/widget/form/3nsZvu171vvOOj7A58WX"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Open in a new tab
            </a>
          </p>
        </CardContent>
      </Card>

      {/* Disconnect Warning Dialog */}
      <AlertDialog open={showDisconnectWarning} onOpenChange={setShowDisconnectWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="h-5 w-5 text-red-600" />
              Disconnect Bonzah?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your Bonzah credentials and disable insurance for new bookings.
              Existing policies will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-red-600 hover:bg-red-700"
            >
              Yes, Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Low Balance Alert Dialog */}
      <Dialog open={showAlertDialog} onOpenChange={setShowAlertDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-blue-600" />
              Low Balance Alert
            </DialogTitle>
            <DialogDescription>
              Get notified when your Bonzah CD balance drops below a threshold.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="alert-enabled" className="font-medium">Enable alerts</Label>
              <Switch
                id="alert-enabled"
                checked={alertEnabled}
                onCheckedChange={setAlertEnabled}
              />
            </div>
            {alertEnabled && (
              <div className="space-y-2">
                <Label htmlFor="alert-threshold">Threshold amount ($)</Label>
                <Input
                  id="alert-threshold"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="e.g. 500"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  You'll receive an in-app notification and email when your balance drops below this amount.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAlertDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAlert}
              disabled={updateConfig.isPending}
            >
              {updateConfig.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BonzahSettings;
