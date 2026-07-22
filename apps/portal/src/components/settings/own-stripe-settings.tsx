'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link2, CheckCircle2, Loader2, ExternalLink, TestTube2, Zap } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';

interface OwnStripeStatus {
  id: string;
  stripe_mode: 'test' | 'live';
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  own_stripe_connected_at: string | null;
  own_stripe_test_connected_at: string | null;
}

/**
 * "Own Stripe" — the operator connects THEIR OWN Stripe account via OAuth.
 * Payments, deposits and refunds run directly on the operator's account;
 * they keep their own Stripe dashboard, payouts and settings.
 */
export function OwnStripeSettings() {
  const queryClient = useQueryClient();
  const { tenant: tenantContext } = useTenant();
  const [connecting, setConnecting] = useState(false);

  // Surface the OAuth redirect result (?oauth=ok|error) once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('oauth');
    if (result === 'ok') {
      toast({ title: 'Stripe connected', description: 'Your Stripe account is now linked. You can accept payments.' });
    } else if (result === 'error') {
      toast({
        title: 'Stripe connection failed',
        description: 'The authorization was not completed. Please try again.',
        variant: 'destructive',
      });
    }
    if (result) {
      params.delete('oauth');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['own-stripe-status'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: status, isLoading } = useQuery({
    queryKey: ['own-stripe-status', tenantContext?.id],
    queryFn: async (): Promise<OwnStripeStatus> => {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, stripe_mode, own_stripe_account_id, own_stripe_test_account_id, own_stripe_connected_at, own_stripe_test_connected_at')
        .eq('id', tenantContext!.id)
        .single();
      if (error) throw error;
      return data as OwnStripeStatus;
    },
    enabled: !!tenantContext?.id,
  });

  // Operators always connect their REAL (live) Stripe account — it's the
  // account they get paid into, and only a live connection appears in the
  // platform's live dashboard. Test connections exist for rehearsals and are
  // created from the admin's explicit test link, not from here.
  const mode = 'live' as const;              // OAuth always connects the real account
  const tenantMode = status?.stripe_mode || 'test';  // what the tenant actually trades in
  const connectedAccountId = status?.own_stripe_account_id;
  const connectedAt = status?.own_stripe_connected_at;

  const startOAuth = async () => {
    if (!status?.id) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-oauth-start', {
        body: { tenantId: status.id, mode, returnTo: 'portal', origin: window.location.origin },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Could not create the connection link');
      window.location.href = data.url; // same-tab: avoids popup blockers, returns via callback
    } catch (e) {
      toast({
        title: 'Could not start Stripe connection',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
      setConnecting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" /> Your Stripe Account
          <Badge variant="outline" className="ml-2 gap-1">
            {tenantMode === 'live' ? <Zap className="h-3 w-3" /> : <TestTube2 className="h-3 w-3" />}
            {tenantMode === 'live' ? 'Live' : 'Test'} mode
          </Badge>
        </CardTitle>
        <CardDescription>
          Connect your own Stripe account to receive booking payments directly. You keep full
          control — your dashboard, your payouts, your money, instantly in your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectedAccountId ? (
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
            <div>
              <p className="flex items-center gap-2 font-medium text-green-600">
                <CheckCircle2 className="h-4 w-4" /> Connected
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Account <code className="text-xs">{connectedAccountId}</code>
                {connectedAt && ` · linked ${new Date(connectedAt).toLocaleDateString()}`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.open('https://dashboard.stripe.com', '_blank')}>
              <ExternalLink className="h-4 w-4 mr-2" /> Open Stripe Dashboard
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No Stripe account connected for {mode} mode yet. Connecting takes about 2 minutes —
              sign in to your existing Stripe account or create one during the process.
            </p>
            <Button onClick={startOAuth} disabled={connecting}>
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to Stripe…
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-2" /> Connect with Stripe
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
