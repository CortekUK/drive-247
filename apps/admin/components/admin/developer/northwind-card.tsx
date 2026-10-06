'use client';

/**
 * Northwind onboarding — the buttons that used to live on the portal's `/dev`
 * page, driven from here.
 *
 * The admin app cannot reach the portal's browser storage (a different site),
 * so each button stores a one-shot command on the developer row and the open
 * Northwind portal tab carries it out within a few seconds
 * (apps/portal/src/components/dev/dev-bridge.tsx). A tab that is not open picks
 * it up the next time it opens, for ten minutes.
 */

import { useState } from 'react';
import { ExternalLink, Loader2, Play, Sparkles, Wand2 } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { callDeveloper, devUrls } from './developer-api';

type Busy = 'first_run' | 'quick_tour' | 'demo' | null;

export function NorthwindCard() {
  const [busy, setBusy] = useState<Busy>(null);
  const urls = devUrls();

  const queue = async (portalAction: 'first_run' | 'quick_tour', label: Busy): Promise<boolean> => {
    setBusy(label);
    const res = await callDeveloper({ action: 'command', portalAction });
    setBusy(null);
    if (!res.ok) {
      toast.error('Could not send that to Northwind', { description: res.error ?? undefined });
      return false;
    }
    return true;
  };

  const actions = [
    {
      key: 'first_run' as const,
      icon: Wand2,
      title: 'First-time operator',
      hint: 'Resets the first-run wizard, the tour and the checklist, then reloads Northwind as a brand-new operator would see it.',
      run: async () => {
        if (await queue('first_run', 'first_run')) {
          toast.success('Sent — the Northwind tab reloads as a first-time operator');
        }
      },
    },
    {
      key: 'quick_tour' as const,
      icon: Play,
      title: 'Quick tour',
      hint: 'Plays the dashboard tour again in the open Northwind tab. Nothing is reset.',
      run: async () => {
        if (await queue('quick_tour', 'quick_tour')) toast.success('Sent — the tour starts in the Northwind tab');
      },
    },
    {
      key: 'demo' as const,
      icon: Sparkles,
      title: 'Demo signup journey',
      hint: 'The same reset as First-time operator, then the pretend signup on the landing page. No real account or payment.',
      run: async () => {
        if (await queue('first_run', 'demo')) window.open(urls.demoSignup, '_blank', 'noopener');
      },
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Northwind onboarding</CardTitle>
        <CardDescription>
          Keep Northwind open in another tab; these happen there within a few seconds.{' '}
          <a href={urls.portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Open Northwind <ExternalLink className="size-3.5" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {actions.map((a) => (
          <div key={a.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 max-w-xl items-start gap-3">
              <a.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{a.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{a.hint}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void a.run()} disabled={busy !== null}>
              {busy === a.key && <Loader2 className="mr-2 size-4 animate-spin" />}
              Run
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
