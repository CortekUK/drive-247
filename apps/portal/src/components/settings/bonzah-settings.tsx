'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Shield, CheckCircle2, AlertCircle, ExternalLink, Loader2, TestTube2, Zap, Unplug } from 'lucide-react';
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

interface BonzahStatus {
  bonzah_mode: 'test' | 'live';
  bonzah_username: string | null;
  bonzah_password: string | null;
  integration_bonzah: boolean;
}

export function BonzahSettings() {
  const queryClient = useQueryClient();
  const { tenant: tenantContext, refetchTenant } = useTenant();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [showModeWarning, setShowModeWarning] = useState(false);
  const [pendingMode, setPendingMode] = useState<'test' | 'live' | null>(null);
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);

  // Fetch current Bonzah status
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
  });

  // Mode toggle mutation
  const updateModeMutation = useMutation({
    mutationFn: async (newMode: 'test' | 'live') => {
      if (!tenantContext?.id) throw new Error('No tenant context');

      const { error } = await supabase
        .from('tenants')
        .update({ bonzah_mode: newMode })
        .eq('id', tenantContext.id);

      if (error) throw error;
      return newMode;
    },
    onSuccess: (newMode) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-bonzah-status'] });
      toast({
        title: 'Bonzah Mode Updated',
        description: `Switched to ${newMode} mode. ${
          newMode === 'live'
            ? 'Insurance quotes will use the production Bonzah API.'
            : 'Insurance quotes will use the sandbox Bonzah API.'
        }`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update Bonzah mode',
        variant: 'destructive',
      });
    },
  });

  // Verify & connect mutation
  const handleVerifyAndConnect = async () => {
    if (!tenantContext?.id || !username || !password) return;

    setIsVerifying(true);
    try {
      const mode = bonzahStatus?.bonzah_mode || 'test';

      // Call verify-credentials edge function
      const { data, error } = await supabase.functions.invoke('bonzah-verify-credentials', {
        body: { username, password, mode },
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

  const handleModeToggle = (newMode: 'test' | 'live') => {
    setPendingMode(newMode);
    setShowModeWarning(true);
  };

  const confirmModeSwitch = async () => {
    if (pendingMode) {
      await updateModeMutation.mutateAsync(pendingMode);
    }
    setShowModeWarning(false);
    setPendingMode(null);
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
  const currentMode = bonzahStatus?.bonzah_mode || 'test';
  const portalUrl = currentMode === 'live'
    ? 'https://bonzah.insillion.com/bb1/'
    : 'https://bonzah.sb.insillion.com/bb1/';

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
            Switch between sandbox (test) and production (live) Bonzah API
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
                  {currentMode === 'live'
                    ? 'Using production Bonzah API — insurance policies are real'
                    : 'Using sandbox Bonzah API — insurance policies are test only'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={currentMode === 'test' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModeToggle('test')}
                  disabled={currentMode === 'test' || updateModeMutation.isPending}
                  className={currentMode === 'test' ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600' : 'dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}
                >
                  <TestTube2 className="h-4 w-4 mr-1" />
                  Test
                </Button>
                <Button
                  variant={currentMode === 'live' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModeToggle('live')}
                  disabled={currentMode === 'live' || updateModeMutation.isPending}
                  className={currentMode === 'live' ? 'bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600' : 'dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Live
                </Button>
              </div>
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
                      Warning: This will use the production Bonzah API
                    </div>
                    <div>By switching to live mode:</div>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Insurance quotes and policies will be real</li>
                      <li>Bonzah will issue actual insurance policies to your customers</li>
                      <li>You will receive real monthly invoices from Bonzah</li>
                    </ul>
                    <div className="text-sm font-medium text-red-600 dark:text-red-500">
                      Make sure your Bonzah credentials work with the production API before switching.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium text-blue-700 dark:text-blue-500">
                      Switching back to test mode
                    </div>
                    <div>By switching to test mode:</div>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Insurance quotes will use the sandbox API</li>
                      <li>No real policies will be issued</li>
                      <li>Existing live policies will not be affected</li>
                    </ul>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMode(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmModeSwitch}
              className={pendingMode === 'live' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}
            >
              {updateModeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Switching...
                </>
              ) : (
                <>Yes, Switch to {pendingMode === 'live' ? 'Live' : 'Test'} Mode</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </div>
  );
}

export default BonzahSettings;
