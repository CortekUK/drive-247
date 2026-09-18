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
import { useAuthStore } from '@/stores/auth-store';
import { useIsTestModeUiHidden } from '@/lib/lean-context';

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
  // Lean tenants have no test modes — the Test/Live chip is a concept they
  // do not have. UI only: stripe_mode itself is untouched.
  const hideTestModeUi = useIsTestModeUiHidden();
  // Not `!hideTestModeUi`: the lean tenants that hide the Test/Live chip are exactly
  // the ones a test connection is needed for, so that gate would hide it everywhere
  // it matters. The edge function applies the real authorization either way.
  const isSuperAdmin = useAuthStore((s) => s.appUser?.is_super_admin) === true;
  const [connecting, setConnecting] = useState(false);

  // Surface the OAuth redirect result (?oauth=ok|incomplete|error) once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('oauth');
    if (result === 'ok') {
      toast({ title: 'Stripe connected', description: 'Your Stripe account is now linked. You can accept payments.' });
    } else if (result === 'incomplete') {
      // THE MESSAGE THAT WAS MISSING ON 17 AUG 2026.
      //
      // The connection worked; Stripe simply has not enabled charges yet
      // because the operator has not finished Stripe's own onboarding. Global
      // Motion saw "Stripe connected — you can accept payments" in this exact
      // spot, believed it, and then could not collect a penny for two days
      // across 10 live rentals.
      //
      // Deliberately NOT destructive: nothing failed, and red here would push
      // the operator to redo a step they have already completed correctly.
      // Long duration because it carries an instruction, not an
      // acknowledgement.
      toast({
        title: 'One more step in Stripe',
        description:
          'Your account is linked, but Stripe still needs a few details before it will accept payments. ' +
          'Open your Stripe dashboard and finish the setup prompt — payments switch over automatically once it is done. ' +
          'Until then you will keep taking payments as normal.',
        duration: 15000,
      });
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

  const startOAuth = async (oauthMode: 'test' | 'live' = mode) => {
    if (!status?.id) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-oauth-start', {
        body: { tenantId: status.id, mode: oauthMode, returnTo: 'portal', origin: window.location.origin },
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
          {/* Mode chip hidden for lean tenants (no test modes) */}
          {!hideTestModeUi && (
            <Badge variant="outline" className="ml-2 gap-1">
              {tenantMode === 'live' ? <Zap className="h-3 w-3" /> : <TestTube2 className="h-3 w-3" />}
              {tenantMode === 'live' ? 'Live' : 'Test'} mode
            </Badge>
          )}
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
            <Button onClick={() => startOAuth()} disabled={connecting}>
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

        {/*
         * Connecting a TEST account.
         *
         * The button above is deliberately hardwired to `live`: an operator connects
         * the account they get paid into. Test connections were meant to come from
         * "the admin's explicit test link" — but no such link existed anywhere, so a
         * test account could not be attached at all without writing the column by
         * hand. `stripe-oauth-start` already accepts mode:'test' and already limits
         * the caller to a super admin or this tenant's own admin, so the only piece
         * missing was the way in.
         *
         * Super-admin only, on purpose. An operator who connected a test account
         * without meaning to would see payments stop reaching their real Stripe
         * account. It writes own_stripe_test_account_id/_connected_at and nothing
         * else — the live connection, and stripe_mode, are untouched. Switching the
         * tenant into test mode remains a separate, deliberate act.
         */}
        {isSuperAdmin && (
          <div className="rounded-lg border border-dashed p-4 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <TestTube2 className="h-4 w-4" /> Test account
              <Badge variant="outline" className="text-[10px]">Staff only</Badge>
            </p>
            {status?.own_stripe_test_account_id ? (
              <p className="text-sm text-muted-foreground">
                Connected <code className="text-xs">{status.own_stripe_test_account_id}</code>
                {status.own_stripe_test_connected_at &&
                  ` · linked ${new Date(status.own_stripe_test_connected_at).toLocaleDateString()}`}
                . This tenant trades in <strong>{tenantMode}</strong> mode.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No test account is attached. Connecting one stores it separately from the live
                account above and changes nothing about how this tenant takes payments today.
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => startOAuth('test')} disabled={connecting}>
              {connecting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to Stripe…</>
              ) : (
                <><TestTube2 className="h-4 w-4 mr-2" />
                  {status?.own_stripe_test_account_id ? 'Reconnect test account' : 'Connect a test account'}</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
