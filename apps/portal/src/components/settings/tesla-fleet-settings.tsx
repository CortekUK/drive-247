'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Loader2, TestTube2, Zap, Unplug, Car } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { TeslaLogo } from '@/components/icons/tesla-logo';
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

export function TeslaFleetSettings() {
  const queryClient = useQueryClient();
  const { tenant: tenantContext, refetchTenant } = useTenant();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // Fetch Tesla Fleet status
  const { data: status, isLoading } = useQuery({
    queryKey: ['tesla-fleet-status', tenantContext?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('integration_tesla_fleet, tesla_fleet_mode, tesla_fleet_token_expires_at')
        .eq('id', tenantContext!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!tenantContext?.id,
  });

  // Count enabled vehicles
  const { data: vehicleCount } = useQuery({
    queryKey: ['tesla-fleet-vehicles-count', tenantContext?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantContext!.id)
        .eq('tesla_fleet_enabled', true);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!tenantContext?.id,
  });

  const isConnected = status?.integration_tesla_fleet || false;
  const currentMode = status?.tesla_fleet_mode || 'test';

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('tesla-fleet-api', {
        body: {
          action: 'get_auth_url',
          tenantId: tenantContext?.id,
          returnUrl: `${window.location.origin}/settings`,
        },
      });

      if (error) throw error;

      // Open Tesla OAuth in new tab
      if (data?.authUrl) {
        window.open(data.authUrl, '_blank');
        toast({
          title: 'Tesla Authorization',
          description: 'Complete the authorization in the new tab, then return here.',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Connection Failed',
        description: err.message || 'Failed to initiate Tesla connection',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('tesla-fleet-api', {
        body: { action: 'disconnect', tenantId: tenantContext?.id },
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['tesla-fleet-status'] });
      queryClient.invalidateQueries({ queryKey: ['tesla-fleet-vehicles-count'] });
      await refetchTenant();

      toast({
        title: 'Disconnected',
        description: 'Tesla Fleet API has been disconnected. All vehicle tracking has been disabled.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to disconnect',
        variant: 'destructive',
      });
    } finally {
      setDisconnecting(false);
      setShowDisconnectDialog(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading Tesla Fleet API status...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Tesla Fleet Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <TeslaLogo size={20} className="text-red-500" />
            </div>
            Tesla Fleet API
            {isConnected ? (
              <Badge className="bg-green-600 hover:bg-green-700 ml-auto">Connected</Badge>
            ) : (
              <Badge variant="secondary" className="ml-auto">Not Connected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Track Supercharger usage in real-time and bill customers for charging sessions during their rental.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <>
              {/* Mode Display */}
              <div className="p-4 rounded-lg border bg-gradient-to-r from-red-50 to-orange-50 border-red-200 dark:from-red-950/30 dark:to-orange-950/30 dark:border-red-800">
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
                          <span className="dark:text-white">Test Mode</span>
                        </>
                      )}
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {currentMode === 'live'
                        ? 'Real Supercharger charges are being tracked'
                        : 'Using sandbox data for testing'}
                    </p>
                  </div>
                  {currentMode === 'live' ? (
                    <Badge className="bg-green-600 hover:bg-green-700 shrink-0">LIVE</Badge>
                  ) : (
                    <Badge className="bg-blue-600 hover:bg-blue-700 shrink-0">TEST</Badge>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Car className="h-4 w-4" />
                    Enabled Vehicles
                  </div>
                  <p className="text-2xl font-semibold mt-1">{vehicleCount ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Check compatibility on each vehicle's detail page
                  </p>
                </div>
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Status
                  </div>
                  <p className="text-2xl font-semibold mt-1 text-green-600">Active</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supercharger tracking is enabled
                  </p>
                </div>
              </div>

              {/* How it works */}
              <div className="bg-muted/50 p-4 rounded-lg dark:bg-gray-900/50 dark:border dark:border-gray-800">
                <h4 className="font-medium text-sm mb-2">How it works</h4>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5 font-medium">1.</span>
                    <span>Go to each Tesla vehicle and click "Check Compatibility" to enable tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5 font-medium">2.</span>
                    <span>When a renter uses a Supercharger, the charge appears on the rental's payment breakdown</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5 font-medium">3.</span>
                    <span>You'll receive a notification and can choose to charge the customer or waive it</span>
                  </li>
                </ul>
              </div>

              {/* Disconnect */}
              <div className="pt-2">
                <Button
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setShowDisconnectDialog(true)}
                >
                  <Unplug className="h-4 w-4 mr-2" />
                  Disconnect Tesla Fleet API
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Not connected — info + connect */}
              <div className="bg-muted/50 p-4 rounded-lg dark:bg-gray-900/50 dark:border dark:border-gray-800">
                <div className="flex items-start gap-3">
                  <TeslaLogo size={32} className="text-red-500 shrink-0 mt-1" />
                  <div>
                    <h4 className="font-medium mb-2">Track Supercharger Costs Automatically</h4>
                    <ul className="text-sm text-muted-foreground space-y-1.5">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        <span>Real-time alerts when renters charge at Superchargers</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        <span>One-click billing — charge the customer or waive the fee</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        <span>Integrated into your existing payment breakdown</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        <span>Works with all Tesla models in your fleet</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  You'll need a Tesla Fleet API account. This connects to your Tesla account to access vehicle charging data.
                </p>
              </div>

              <Button onClick={handleConnect} disabled={connecting} className="gap-2">
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TeslaLogo size={16} className="text-white" />
                )}
                {connecting ? 'Connecting...' : 'Connect Tesla Fleet API'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TeslaLogo size={20} className="text-red-500" />
              Disconnect Tesla Fleet API?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will disable Supercharger tracking for all vehicles. Existing charge records will be preserved, but no new charges will be detected. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
