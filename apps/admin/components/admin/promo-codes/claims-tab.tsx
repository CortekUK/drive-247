'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { promoApi, type Claim } from './api';
import { AttachReferralDialog } from './referrals-tab';

/** "Someone joined because of me" claims from operators' Referrals pages (brief R6). */
export function ClaimsTab({ canEdit }: { canEdit: boolean }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Claim | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClaims((await promoApi<{ claims: Claim[] }>('list_claims', {})).claims);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reject = async (c: Claim) => {
    setBusyId(c.id);
    try {
      await promoApi('resolve_claim', { claimId: c.id, decision: 'reject' });
      toast.success('Claim rejected');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (claims.length === 0) return <p className="text-sm text-muted-foreground">No claims yet. Operators send these from their Referrals page.</p>;

  return (
    <div className="space-y-3">
      {claims.map(c => (
        <Card key={c.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm">
                <span className="font-medium">{c.referrerName ?? 'An operator'}</span> says{' '}
                <span className="font-medium">{c.claimed_business_name}</span> joined because of them.
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(c.created_at).toLocaleDateString()}
                {c.claimed_contact ? ` · contact: ${c.claimed_contact}` : ''}
              </p>
              {c.note && <p className="text-xs text-muted-foreground">&ldquo;{c.note}&rdquo;</p>}
            </div>
            <div className="flex items-center gap-2">
              {c.status === 'pending' ? (
                canEdit && (
                  <>
                    <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => reject(c)}>
                      {busyId === c.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Reject
                    </Button>
                    <Button size="sm" onClick={() => setApproving(c)}>Approve…</Button>
                  </>
                )
              ) : (
                <Badge variant={c.status === 'approved' ? 'success' : 'outline'}>{c.status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {approving && (
        <AttachReferralDialog
          claimId={approving.id}
          presetReferrer={{ id: approving.referrer_tenant_id, slug: '', company_name: approving.referrerName }}
          claimLabel={`Find ${approving.claimed_business_name} and attach them to ${approving.referrerName ?? 'the referrer'}.`}
          onClose={() => setApproving(null)}
          onDone={async () => { setApproving(null); await load(); }}
        />
      )}
    </div>
  );
}
