'use client';

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FileSignature, TestTube2, Zap, Loader2 } from 'lucide-react';
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

export function ESignSettings() {
  const queryClient = useQueryClient();
  const { tenant, refetchTenant } = useTenant();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  const currentMode = tenant?.boldsign_mode || 'test';
  const isLive = currentMode === 'live';

  const handleToggleMode = async (wantLive: boolean) => {
    if (wantLive) {
      setShowLiveConfirm(true);
      return;
    }
    await updateMode('test');
  };

  const updateMode = async (newMode: 'test' | 'live') => {
    if (!tenant?.id) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ boldsign_mode: newMode })
        .eq('id', tenant.id);

      if (error) throw error;

      await refetchTenant();
      queryClient.invalidateQueries({ queryKey: ['tenant-boldsign-status'] });

      toast({
        title: newMode === 'live' ? 'Switched to Live Mode' : 'Switched to Test Mode',
        description: newMode === 'live'
          ? 'E-signature documents are now legally binding.'
          : 'E-signature documents will be watermarked and auto-deleted after 14 days.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to update e-signature mode',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
      setShowLiveConfirm(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            E-Signature Mode
          </CardTitle>
          <CardDescription>
            Control whether rental agreements use the BoldSign sandbox or production environment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode display */}
          <div className={`p-4 rounded-lg border ${
            isLive
              ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 dark:from-green-950/30 dark:to-emerald-950/30 dark:border-green-800'
              : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 dark:from-blue-950/30 dark:to-indigo-950/30 dark:border-blue-800'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h4 className="font-medium flex items-center gap-2">
                  {isLive ? (
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
                <p className="text-sm text-muted-foreground mt-1 dark:text-gray-300">
                  {isLive
                    ? 'Documents are legally binding.'
                    : 'Documents are watermarked and auto-deleted after 14 days. Not legally binding.'}
                </p>
              </div>
              {isLive ? (
                <Badge className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 shrink-0">LIVE</Badge>
              ) : (
                <Badge className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 shrink-0">TEST</Badge>
              )}
            </div>
          </div>

          {/* Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50 dark:bg-gray-900/50 dark:border-gray-700">
            <div>
              <Label htmlFor="boldsign-mode-toggle" className="font-medium">
                {isLive ? 'Live Mode Enabled' : 'Test Mode Enabled'}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Toggle to switch between test and live environments
              </p>
            </div>
            {isUpdating ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                id="boldsign-mode-toggle"
                checked={isLive}
                onCheckedChange={handleToggleMode}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog for switching to live */}
      <AlertDialog open={showLiveConfirm} onOpenChange={setShowLiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-green-600" />
              Switch to Live Mode?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Documents created in live mode are legally binding and will not be watermarked.
              Make sure you have tested your agreement template thoroughly before switching.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => updateMode('live')}
              className="bg-green-600 hover:bg-green-700"
            >
              Yes, Switch to Live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ESignSettings;
