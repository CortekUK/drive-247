'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';
import { money, promoApi, type TenantLite } from './api';

type Leader = {
  tenant_id: string;
  name: string | null;
  slug: string | null;
  active_referrals: number;
  total_referrals: number;
  reward: string | null;
  savedCents: number;
  last_error: string | null;
};

export function LeaderboardTab({ onOpen }: { onOpen: (t: TenantLite) => void }) {
  const [rows, setRows] = useState<Leader[] | null>(null);
  useEffect(() => {
    promoApi<{ leaders: Leader[] }>('leaderboard', {})
      .then(r => setRows(r.leaders))
      .catch(e => { toast.error((e as Error).message); setRows([]); });
  }, []);

  if (!rows) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No referrers yet.</p>;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operator</TableHead>
              <TableHead>Subscribed referrals</TableHead>
              <TableHead>Referred in total</TableHead>
              <TableHead>Reward</TableHead>
              <TableHead>Saved so far</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.tenant_id} className="cursor-pointer" onClick={() => onOpen({ id: r.tenant_id, slug: r.slug ?? '', company_name: r.name })}>
                <TableCell className="text-sm font-medium">
                  {r.name ?? r.slug}
                  {r.last_error && <p className="text-xs text-destructive">Sync problem</p>}
                </TableCell>
                <TableCell className="text-sm">{r.active_referrals}</TableCell>
                <TableCell className="text-sm">{r.total_referrals}</TableCell>
                <TableCell className="text-sm">{r.reward ?? <span className="text-muted-foreground">None yet</span>}</TableCell>
                <TableCell className="text-sm">{money(r.savedCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
