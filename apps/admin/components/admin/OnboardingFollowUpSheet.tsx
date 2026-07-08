'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Copy,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  MessageSquareText,
  Send,
  Clock,
  History,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

export interface FollowUpTenantRow {
  tenant_id: string;
  slug: string;
  company_name: string;
  contact_email: string | null;
  admin_name: string | null;
  created_at: string;
  branding_done: boolean;
  subscription_done: boolean;
  bonzah_done: boolean;
  bonzah_form_submitted: boolean;
  bonzah_form_status: string | null;
  brandon_sent: boolean;
  brandon_sent_at: string | null;
}

interface PlanInfo {
  name: string;
  amount: number;
  currency: string;
  interval: string;
  trial_days: number;
}

interface SubInfo {
  status: string;
  created_at: string;
  current_period_end: string | null;
}

interface FollowUp {
  id: string;
  contacted_at: string;
  stage: string;
  channel: string;
  message: string | null;
}

type Stage =
  | 'activate_and_insurance'
  | 'activate_subscription'
  | 'insurance_form'
  | 'send_to_brandon'
  | 'waiting_bonzah'
  | 'onboarded';

const STAGE_META: Record<Stage, { label: string; action: string; tone: 'red' | 'amber' | 'sky' | 'green' }> = {
  activate_and_insurance: {
    label: 'Needs subscription + insurance form',
    action: 'Ask them to activate their subscription and fill the Bonzah form.',
    tone: 'red',
  },
  activate_subscription: {
    label: 'Needs subscription (form already in)',
    action: 'Their insurance form is in — just the subscription activation left.',
    tone: 'amber',
  },
  insurance_form: {
    label: 'Subscribed — needs insurance form',
    action: 'They are paying customers. Get the Bonzah form filled to finish setup.',
    tone: 'amber',
  },
  send_to_brandon: {
    label: 'Form submitted — send to Brandon',
    action: 'Internal step first: use the "Send to Brandon" button on their row, then reassure the client.',
    tone: 'sky',
  },
  waiting_bonzah: {
    label: 'Waiting on Bonzah approval',
    action: 'Nothing needed from the client — keep them warm with a status update.',
    tone: 'sky',
  },
  onboarded: {
    label: 'Fully onboarded',
    action: 'All steps complete — a congrats / check-in message keeps the relationship strong.',
    tone: 'green',
  },
};

const toneClasses: Record<string, string> = {
  red: 'bg-destructive/15 text-destructive border-destructive/30',
  amber: 'bg-warning/15 text-warning border-warning/30',
  sky: 'bg-sky-400/15 text-sky-400 border-sky-400/30',
  green: 'bg-success/15 text-success border-success/30',
};

const firstName = (name: string | null) => {
  const n = (name || '').trim().split(/\s+/)[0] || 'there';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency?.toUpperCase() || 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

const hoursSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

const weekday = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'long' });

const agoLabel = (iso: string) => {
  const d = daysSince(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
};

function computeStage(r: FollowUpTenantRow): Stage {
  if (r.branding_done && r.subscription_done && r.bonzah_done) return 'onboarded';
  if (r.bonzah_form_submitted && !r.bonzah_done) {
    return r.brandon_sent ? 'waiting_bonzah' : 'send_to_brandon';
  }
  if (!r.subscription_done && !r.bonzah_form_submitted) return 'activate_and_insurance';
  if (!r.subscription_done) return 'activate_subscription';
  return 'insurance_form';
}

function buildMessage(opts: {
  row: FollowUpTenantRow;
  stage: Stage;
  plan: PlanInfo | null;
  hasLogo: boolean;
  followUps: FollowUp[];
}): string {
  const { row, stage, plan, hasLogo, followUps } = opts;
  const name = firstName(row.admin_name);
  const portal = `https://${row.slug}.portal.drive-247.com`;
  const bonzahLink = `${portal}/settings?tab=insurance`;
  const planBit = plan ? `your ${plan.name} plan (${money(plan.amount, plan.currency)}/${plan.interval})` : 'your plan';
  const contacts = followUps.length;
  const signupAgo = daysSince(row.created_at);

  const dollarExplainer =
    `A quick note on how activation works, so there are no surprises: a $1 charge is made to your card purely to validate it — ` +
    `it's refunded right back to you. You pay nothing today; regular billing only starts with your next monthly cycle.`;

  const logoPs = !hasLogo
    ? `\n\nP.S. Whenever you have your logo handy, send it over and we'll get it styled into your booking site.`
    : '';

  // Follow-up (they've been contacted before) → shorter, conversational nudge
  const isNudge = contacts >= 1;
  const isCallOffer = contacts >= 2;

  switch (stage) {
    case 'activate_and_insurance': {
      if (isCallOffer)
        return (
          `Hi ${name}, George here from Drive247. I know things get busy, so I'd love to just jump on a quick 10-minute call and get ${row.company_name} live together — ` +
          `we'll activate your subscription (only a $1 card check, refunded straight away) and knock out the short insurance form while we're at it. ` +
          `What time works for you today or tomorrow?`
        );
      if (isNudge)
        return (
          `Hi ${name}, just checking in — your ${row.company_name} platform is ready and waiting. Two quick steps left:\n\n` +
          `1. Activate ${planBit} in your portal: ${portal} — it's just a $1 card check that's refunded right away, nothing to pay today.\n` +
          `2. Fill in the short insurance form: ${bonzahLink}\n\n` +
          `About 5 minutes total and you're live. Happy to walk you through it on a quick call if that's easier!`
        );
      return (
        `Hi ${name},\n\n` +
        `Great news — your ${row.company_name} platform is fully set up and ready to go${signupAgo <= 7 ? ` since ${weekday(row.created_at)}` : ''}. ` +
        `Just two quick steps left to get you live:\n\n` +
        `1. Activate your subscription (2 min)\n` +
        `Log in at ${portal} and click Subscribe on ${planBit}. ${dollarExplainer}\n\n` +
        `2. Complete the insurance form (3 min)\n` +
        `Fill in the short Bonzah insurance form here: ${bonzahLink}\n` +
        `This activates rental insurance for your customers so every booking is covered from day one — we handle the rest with the Bonzah team for you.\n\n` +
        `Once both are done, you're live and taking bookings. Happy to jump on a quick call and walk you through it — just reply with a good time.\n\n` +
        `Best,\nGeorge — Drive247 Team${logoPs}`
      );
    }
    case 'activate_subscription': {
      if (isNudge)
        return (
          `Hi ${name}, quick one — your insurance setup is moving along nicely on our side. ` +
          `The only thing left is activating ${planBit} at ${portal}. It's just a $1 card check (refunded immediately), nothing to pay today — ` +
          `and the moment it's done, ${row.company_name} is live. Shall I give you a call to do it together?`
        );
      return (
        `Hi ${name},\n\n` +
        `Thanks for sending in your insurance form — that's with the Bonzah team now, and we're handling it for you.\n\n` +
        `The one step left to get ${row.company_name} live: activate your subscription at ${portal}. ${dollarExplainer}\n\n` +
        `Once that's done, your dashboard, booking site and payments are fully unlocked. Any questions, I'm right here.\n\n` +
        `Best,\nGeorge — Drive247 Team${logoPs}`
      );
    }
    case 'insurance_form': {
      if (isNudge)
        return (
          `Hi ${name}, hope business prep is going well! One small thing still open on ${row.company_name}: the short insurance form at ${bonzahLink} — ` +
          `takes about 3 minutes, and it means every booking you take is covered from day one. Want me to stay on the line while you fill it in?`
        );
      return (
        `Hi ${name},\n\n` +
        `Your ${row.company_name} subscription is active — welcome aboard!\n\n` +
        `One last step to complete your setup: the short Bonzah insurance form at ${bonzahLink} (about 3 minutes). ` +
        `It activates rental insurance for your customers so every booking is covered from day one — we take care of the rest with the Bonzah team for you.\n\n` +
        `Once it's in, you're fully live. Happy to help over a quick call if you'd like.\n\n` +
        `Best,\nGeorge — Drive247 Team${logoPs}`
      );
    }
    case 'send_to_brandon':
      return (
        `Hi ${name},\n\n` +
        `Just to keep you posted — we've received your insurance form and it's being processed with the Bonzah team right now. ` +
        `Nothing more needed from you at this stage; we'll let you know the moment your coverage is active.\n\n` +
        `Best,\nGeorge — Drive247 Team`
      );
    case 'waiting_bonzah':
      return (
        `Hi ${name},\n\n` +
        `Quick update on ${row.company_name}: your insurance setup is with the Bonzah team${row.brandon_sent_at ? ` (sent over on ${fmtDate(row.brandon_sent_at)})` : ''} and progressing. ` +
        `Nothing needed from you — we'll confirm as soon as your coverage goes live.\n\n` +
        `Best,\nGeorge — Drive247 Team`
      );
    case 'onboarded':
      return (
        `Hi ${name},\n\n` +
        `Congratulations — ${row.company_name} is fully live! Subscription active, insurance in place, booking site ready to take rentals.\n\n` +
        `How's everything feeling so far? If you'd like, I can walk you through a couple of features operators love — the fleet calendar and automated reminders are great first wins.\n\n` +
        `Best,\nGeorge — Drive247 Team`
      );
  }
}

export default function OnboardingFollowUpSheet({
  row,
  open,
  onOpenChange,
}: {
  row: FollowUpTenantRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState('email');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const stage: Stage | null = useMemo(() => (row ? computeStage(row) : null), [row]);

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [planRes, subRes, tenantRes, fuRes] = await Promise.all([
          (supabase as any)
            .from('subscription_plans')
            .select('name, amount, currency, interval, trial_days')
            .eq('tenant_id', row.tenant_id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .limit(1),
          (supabase as any)
            .from('tenant_subscriptions')
            .select('status, created_at, current_period_end')
            .eq('tenant_id', row.tenant_id)
            .order('created_at', { ascending: false })
            .limit(1),
          (supabase as any)
            .from('tenants')
            .select('logo_url')
            .eq('id', row.tenant_id)
            .single(),
          (supabase as any)
            .from('onboarding_followups')
            .select('id, contacted_at, stage, channel, message')
            .eq('tenant_id', row.tenant_id)
            .order('contacted_at', { ascending: false })
            .limit(20),
        ]);
        if (cancelled) return;
        const planRow = planRes.data?.[0] ?? null;
        const subRow = subRes.data?.[0] ?? null;
        const logo = !!tenantRes.data?.logo_url;
        const fus = (fuRes.data || []) as FollowUp[];
        setPlan(planRow);
        setSub(subRow);
        setHasLogo(logo);
        setFollowUps(fus);
        setMessage(
          buildMessage({
            row,
            stage: computeStage(row),
            plan: planRow,
            hasLogo: logo,
            followUps: fus,
          }),
        );
      } catch (err: any) {
        toast.error('Failed to load tenant details: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row?.tenant_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success('Message copied — paste it into your email or WhatsApp');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleMarkContacted = async () => {
    if (!row || !stage) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any)
        .from('onboarding_followups')
        .insert({
          tenant_id: row.tenant_id,
          stage,
          channel,
          message,
        })
        .select('id, contacted_at, stage, channel, message')
        .single();
      if (error) throw error;
      const next = [data as FollowUp, ...followUps];
      setFollowUps(next);
      toast.success(`Logged — ${row.company_name} marked as contacted via ${channel}`);
      // Regenerate for the *next* touch so George sees what tomorrow's message looks like
      setMessage(buildMessage({ row, stage, plan, hasLogo, followUps: next }));
    } catch (err: any) {
      toast.error('Failed to log contact: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!row || !stage) return null;

  const meta = STAGE_META[stage];
  const lastContact = followUps[0] ?? null;
  const contactedRecently = lastContact ? hoursSince(lastContact.contacted_at) < 48 : false;

  const facts: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Contact',
      value: (
        <span>
          {row.admin_name || '—'}
          {row.contact_email && (
            <span className="block text-xs text-muted-foreground">{row.contact_email}</span>
          )}
        </span>
      ),
    },
    {
      label: 'Signed up',
      value: `${fmtDate(row.created_at)} · ${agoLabel(row.created_at)}`,
    },
    {
      label: 'Plan',
      value: plan
        ? `${plan.name} — ${money(plan.amount, plan.currency)}/${plan.interval}`
        : 'No plan configured yet',
    },
    {
      label: 'Subscription',
      value: row.subscription_done ? (
        <span className="text-success">
          Active{sub ? ` — subscribed ${fmtDate(sub.created_at)}` : ''}
        </span>
      ) : (
        <span className="text-warning">Not activated</span>
      ),
    },
    {
      label: 'Insurance form',
      value: row.bonzah_form_submitted ? (
        <span className="text-success">
          Submitted{row.bonzah_form_status ? ` · ${row.bonzah_form_status}` : ''}
        </span>
      ) : (
        <span className="text-warning">Not submitted</span>
      ),
    },
    {
      label: 'Sent to Brandon',
      value: row.brandon_sent ? (
        <span className="text-success">Yes · {fmtDate(row.brandon_sent_at)}</span>
      ) : (
        <span className="text-muted-foreground">Not yet</span>
      ),
    },
    {
      label: 'Last contacted',
      value: lastContact ? (
        `${fmtDate(lastContact.contacted_at)} · ${agoLabel(lastContact.contacted_at)} via ${lastContact.channel}`
      ) : (
        <span className="text-muted-foreground">Never — first touch</span>
      ),
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto bg-background border-border">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            {row.company_name}
          </SheetTitle>
          <SheetDescription>
            {row.slug} · follow-up assistant
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Stage */}
          <div className={cn('rounded-lg border px-3 py-2.5 text-sm', toneClasses[meta.tone])}>
            <div className="font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {meta.label}
            </div>
            <p className="text-xs mt-1 opacity-90">{meta.action}</p>
          </div>

          {contactedRecently && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Contacted {agoLabel(lastContact!.contacted_at)} via {lastContact!.channel} — you may
                want to give it a moment before the next touch.
              </span>
            </div>
          )}

          {/* Facts */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border">
              {facts.map((f) => (
                <div key={f.label} className="flex items-start justify-between gap-4 px-3 py-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap pt-0.5">
                    {f.label}
                  </span>
                  <span className="text-sm text-right">{f.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Progress dots */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {[
              { label: 'Branding', done: row.branding_done },
              { label: 'Subscription', done: row.subscription_done },
              { label: 'Bonzah', done: row.bonzah_done },
            ].map((s) => (
              <span key={s.label} className="flex items-center gap-1">
                {s.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
                {s.label}
              </span>
            ))}
          </div>

          <Separator />

          {/* Suggested message */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-primary" />
                Suggested message right now
              </h3>
              <Badge variant="outline" className="text-[10px]">
                {followUps.length === 0
                  ? 'first touch'
                  : followUps.length === 1
                    ? 'follow-up'
                    : `touch #${followUps.length + 1}`}
              </Badge>
            </div>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={12}
                className="text-sm leading-relaxed"
              />
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              Generated for this exact moment — edit freely before sending.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleCopy} disabled={loading} className="flex-1 min-w-[140px]">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy message'}
            </Button>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleMarkContacted}
              disabled={saving || loading}
              className="flex-1 min-w-[150px]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              Mark contacted
            </Button>
          </div>

          {/* History */}
          {followUps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                Contact history
              </h3>
              <div className="space-y-1.5">
                {followUps.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {fmtDate(f.contacted_at)} · {agoLabel(f.contacted_at)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {f.channel}
                      </Badge>
                      <span className="text-muted-foreground">{f.stage.split('_').join(' ')}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
