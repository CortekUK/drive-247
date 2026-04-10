'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Unplug,
  Send,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Shield,
  Webhook,
  UserPlus,
  Phone,
  Key,
  Zap,
  Clock,
  Sparkles,
  Info,
  Lightbulb,
} from 'lucide-react';
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
import { useTwilioSms } from '@/hooks/use-twilio-sms';

// Supabase URL used to build the webhook URLs tenants see in the connected state.
// Read from the same env var the rest of the app uses.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const INBOUND_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/twilio-inbound-sms`;
const STATUS_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/twilio-sms-status`;

// Small inline copy-to-clipboard button
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span className="ml-1.5">{label}</span>}
    </Button>
  );
}

export function TwilioSmsSettings() {
  const { status, isLoading, connect, sendTestSms, disconnect } = useTwilioSms();

  // Connect form state
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  // Connected-state test SMS form
  const [testTo, setTestTo] = useState('');
  const [testMessage, setTestMessage] = useState('');

  // Disconnect confirmation
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading SMS settings…</span>
        </CardContent>
      </Card>
    );
  }

  // --- CONNECTED STATE ---
  if (status?.isConnected) {
    return (
      <div className="space-y-6">
        {/* Status card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-indigo-600" />
              Twilio SMS
              <Badge className="bg-green-600 hover:bg-green-700 text-xs">Connected</Badge>
            </CardTitle>
            <CardDescription>
              Your Twilio account is connected and ready to send SMS from the Messages page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border bg-[#f8fafc]">
              <div>
                <p className="text-xs text-[#737373] mb-1">Account SID</p>
                <p className="text-sm font-mono text-[#080812]">{status.accountSidMasked || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-[#737373] mb-1">Phone Number</p>
                <p className="text-sm font-mono text-[#080812]">{status.phoneNumber || '—'}</p>
              </div>
              {status.connectedAt && (
                <div>
                  <p className="text-xs text-[#737373] mb-1">Connected</p>
                  <p className="text-sm text-[#080812]">
                    {new Date(status.connectedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              )}
              {status.capabilities && (
                <div>
                  <p className="text-xs text-[#737373] mb-1">Capabilities</p>
                  <div className="flex gap-1.5">
                    {status.capabilities.sms && (
                      <Badge variant="secondary" className="text-xs">SMS</Badge>
                    )}
                    {status.capabilities.mms && (
                      <Badge variant="secondary" className="text-xs">MMS</Badge>
                    )}
                    {status.capabilities.voice && (
                      <Badge variant="secondary" className="text-xs">Voice</Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Test SMS card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-indigo-600" />
              Send a test message
            </CardTitle>
            <CardDescription>
              Verify your connection by sending a test SMS to your own phone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label htmlFor="test-to" className="text-xs text-[#404040]">
                  Recipient phone (E.164 format, e.g. +14155551234)
                </Label>
                <Input
                  id="test-to"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="+14155551234"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="test-msg" className="text-xs text-[#404040]">
                  Message (optional)
                </Label>
                <Textarea
                  id="test-msg"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="Leave blank for a default test message"
                  rows={2}
                  className="mt-1"
                />
              </div>
            </div>
            <Button
              onClick={() => sendTestSms.mutate({ to: testTo, message: testMessage })}
              disabled={!testTo || sendTestSms.isPending}
              className="w-full sm:w-auto"
            >
              {sendTestSms.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
              ) : (
                <><Send className="mr-2 h-4 w-4" />Send Test SMS</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Webhook URLs (in case tenant needs to re-apply manually) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Webhook className="h-4 w-4 text-indigo-600" />
              Webhook URLs
            </CardTitle>
            <CardDescription>
              We configured these automatically on your Twilio number when you connected.
              If you ever need to re-apply them manually, here they are.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs text-[#404040]">Inbound SMS (A MESSAGE COMES IN)</Label>
              <div className="flex gap-2">
                <Input value={INBOUND_WEBHOOK_URL} readOnly className="font-mono text-xs" />
                <CopyButton value={INBOUND_WEBHOOK_URL} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-[#404040]">Status callback</Label>
              <div className="flex gap-2">
                <Input value={STATUS_WEBHOOK_URL} readOnly className="font-mono text-xs" />
                <CopyButton value={STATUS_WEBHOOK_URL} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disconnect */}
        <Card>
          <CardContent className="p-4">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectConfirm(true)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full sm:w-auto"
            >
              <Unplug className="mr-2 h-4 w-4" />
              Disconnect Twilio
            </Button>
          </CardContent>
        </Card>

        <AlertDialog open={showDisconnectConfirm} onOpenChange={setShowDisconnectConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Unplug className="h-5 w-5 text-red-600" />
                Disconnect Twilio?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes your Twilio credentials from Drive247. Your Twilio account,
                phone number, and messages stay exactly as they are — we just forget the
                credentials. You can reconnect at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  disconnect.mutate();
                  setShowDisconnectConfirm(false);
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                Yes, disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // --- DISCONNECTED STATE (Connect wizard) ---
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-indigo-600" />
            Connect your Twilio account
          </CardTitle>
          <CardDescription>
            Drive247 uses your own Twilio account for SMS. This means you keep control
            of your messaging, pay Twilio directly, and own your phone number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* How it works — expandable guide */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-indigo-50/60 via-background to-purple-50/40 dark:from-indigo-950/30 dark:via-background dark:to-purple-950/20 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setShowGuide((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-md" />
                  <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                </div>
                <span className="flex flex-col items-start">
                  <span className="font-semibold">How to set up your Twilio account</span>
                  <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Takes about 10 minutes
                  </span>
                </span>
              </span>
              {showGuide ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {showGuide && (
              <div className="px-4 pb-4 pt-3 space-y-3 text-sm border-t border-border bg-card/50 backdrop-blur-sm">
                <Step
                  num={1}
                  icon={<UserPlus className="h-4 w-4" />}
                  accent="indigo"
                  title="Create your Twilio account"
                  subtitle="Skip if you already have one"
                  body={
                    <div className="space-y-2.5">
                      <p>
                        Open{' '}
                        <ExtLink href="https://www.twilio.com/try-twilio">
                          twilio.com/try-twilio
                        </ExtLink>{' '}
                        in a new tab.
                      </p>
                      <ul className="space-y-1.5">
                        <Bullet>Sign up with your business email and a strong password.</Bullet>
                        <Bullet>Twilio will email you a confirmation link — click it.</Bullet>
                        <Bullet>
                          Verify your mobile phone number when prompted (Twilio sends a one-time
                          code).
                        </Bullet>
                        <Bullet>
                          On the "Welcome to Twilio" walkthrough, the defaults are fine. You can
                          skip the "What do you want to build?" questionnaire — it doesn't affect
                          anything.
                        </Bullet>
                        <Bullet>
                          You'll land on the <Strong>Twilio Console</Strong> dashboard. That's
                          your home base.
                        </Bullet>
                      </ul>
                      <Tip icon="💰">
                        Free trial includes ~$15 of credit. No credit card required to start.
                      </Tip>
                    </div>
                  }
                />

                <Step
                  num={2}
                  icon={<Phone className="h-4 w-4" />}
                  accent="blue"
                  title="Buy a phone number"
                  subtitle="~$1.15 / £1 per month"
                  body={
                    <div className="space-y-2.5">
                      <p>
                        In the Twilio Console, open{' '}
                        <ExtLink href="https://console.twilio.com/us1/develop/phone-numbers/manage/search">
                          Phone Numbers → Manage → Buy a number
                        </ExtLink>
                        .
                      </p>
                      <ul className="space-y-1.5">
                        <Bullet>
                          <Strong>Country</Strong> — pick your region (UK, US, etc.).
                        </Bullet>
                        <Bullet>
                          <Strong>Capabilities</Strong> — tick <Strong>SMS</Strong>. If you'll
                          use voice calling later too, also tick <Strong>Voice</Strong>.
                        </Bullet>
                        <Bullet>
                          Optionally type an <Strong>area code</Strong> if you want a specific
                          one.
                        </Bullet>
                        <Bullet>
                          Click <Strong>Search</Strong>.
                        </Bullet>
                        <Bullet>
                          Pick any number from the list and click the blue{' '}
                          <Strong>Buy</Strong> button next to it.
                        </Bullet>
                        <Bullet>
                          Confirm the purchase in the popup — comes out of your trial credit.
                        </Bullet>
                      </ul>
                      <p>
                        Once bought, the number appears in{' '}
                        <ExtLink href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming">
                          Active Numbers
                        </ExtLink>
                        . Copy it down — you'll need it in the form below in E.164 format (e.g.{' '}
                        <Code>+14155551234</Code>, with the leading <Strong>+</Strong> and
                        country code).
                      </p>
                      <Tip icon="💡">
                        Already have a number on your account? Skip the buy step — just go to
                        Active Numbers and grab the one you want.
                      </Tip>
                    </div>
                  }
                />

                <Step
                  num={3}
                  icon={<Key className="h-4 w-4" />}
                  accent="purple"
                  title="Copy your Account SID and Auth Token"
                  subtitle="Your Twilio credentials"
                  body={
                    <div className="space-y-2.5">
                      <p>
                        Go back to the{' '}
                        <ExtLink href="https://console.twilio.com">
                          Twilio Console homepage
                        </ExtLink>{' '}
                        (or click the Twilio logo in the top-left).
                      </p>
                      <ul className="space-y-1.5">
                        <Bullet>
                          Scroll down until you see a panel labeled{' '}
                          <Strong>Account Info</Strong>.
                        </Bullet>
                        <Bullet>You'll see two values:</Bullet>
                      </ul>
                      <div className="ml-6 grid gap-2">
                        <div className="rounded-lg border border-border bg-background/60 p-2.5">
                          <p className="text-xs font-semibold text-foreground mb-0.5">
                            Account SID
                          </p>
                          <p className="text-xs text-muted-foreground">
                            A long string starting with <Code>AC</Code> — always visible. Click
                            the copy icon next to it.
                          </p>
                        </div>
                        <div className="rounded-lg border border-border bg-background/60 p-2.5">
                          <p className="text-xs font-semibold text-foreground mb-0.5">
                            Auth Token
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Hidden by default. Click the <Strong>eye icon</Strong> or "Show" link
                            to reveal it, then click the copy icon.
                          </p>
                        </div>
                      </div>
                      <Callout
                        tone="amber"
                        icon={<Shield className="h-4 w-4" />}
                        title="Treat the Auth Token like a password"
                      >
                        Anyone with it can send messages from your account and run up your bill.
                        We store it encrypted and never expose it back to your browser.
                      </Callout>
                    </div>
                  }
                />

                <Step
                  num={4}
                  icon={<Zap className="h-4 w-4" />}
                  accent="emerald"
                  title="Click Connect — we handle the rest"
                  subtitle="~5 seconds"
                  body={
                    <div className="space-y-2.5">
                      <p>
                        Once all three fields below are filled, click{' '}
                        <Strong>Connect Twilio</Strong>. We'll automatically:
                      </p>
                      <ul className="space-y-1.5">
                        <BulletCheck>Verify your credentials with Twilio</BulletCheck>
                        <BulletCheck>
                          Confirm the phone number exists on your account and supports SMS
                        </BulletCheck>
                        <BulletCheck>
                          Wire up inbound SMS webhooks (so customer replies land in the Messages
                          page)
                        </BulletCheck>
                        <BulletCheck>Save everything securely</BulletCheck>
                      </ul>
                      <p className="text-muted-foreground">
                        You'll see a "Twilio Connected" confirmation when it's done. 🎉
                      </p>
                    </div>
                  }
                />

                {/* Trial account caller verification — important gotcha */}
                <Callout
                  tone="blue"
                  icon={<Info className="h-4 w-4" />}
                  title="Trial accounts: verify your test number first"
                >
                  Twilio trial accounts can only send SMS to{' '}
                  <Strong>verified caller IDs</Strong>. Before you click "Send Test SMS" later,
                  go to{' '}
                  <a
                    href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified"
                    target="_blank"
                    rel="noreferrer"
                    className="underline inline-flex items-center gap-0.5 font-medium"
                  >
                    Phone Numbers → Verified Caller IDs
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>{' '}
                  and add your own mobile number. Paid accounts skip this entirely. (Twilio
                  limitation, not ours.)
                </Callout>

                {/* US/Canada 10DLC note */}
                <Callout
                  tone="neutral"
                  icon={<Lightbulb className="h-4 w-4" />}
                  title="US / Canada numbers only"
                >
                  Twilio requires 10DLC brand &amp; campaign registration for sending SMS to US
                  or Canadian recipients. SMS works immediately for everywhere else, but for
                  US/CA you'll need to complete the one-time registration in your Twilio console
                  (under <em>Messaging → Regulatory Compliance</em>). About 15 minutes of forms
                  + 1–7 days of carrier review.
                </Callout>
              </div>
            )}
          </div>

          {/* Connect form */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="account-sid" className="text-sm">
                Account SID
              </Label>
              <Input
                id="account-sid"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value.trim())}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="mt-1 font-mono"
              />
              <p className="text-xs text-[#737373] mt-1">
                Starts with "AC". Found on your Twilio console homepage.
              </p>
            </div>

            <div>
              <Label htmlFor="auth-token" className="text-sm">
                Auth Token
              </Label>
              <Input
                id="auth-token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value.trim())}
                placeholder="Your Twilio Auth Token"
                className="mt-1 font-mono"
              />
              <p className="text-xs text-[#737373] mt-1">
                Stored securely. We use it to send SMS on your behalf.
              </p>
            </div>

            <div>
              <Label htmlFor="phone-number" className="text-sm">
                Phone Number
              </Label>
              <Input
                id="phone-number"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.trim())}
                placeholder="+14155551234"
                className="mt-1 font-mono"
              />
              <p className="text-xs text-[#737373] mt-1">
                Must already exist on your Twilio account. Use E.164 format (+ country code).
              </p>
            </div>
          </div>

          <Button
            onClick={() => connect.mutate({ accountSid, authToken, phoneNumber })}
            disabled={!accountSid || !authToken || !phoneNumber || connect.isPending}
            className="w-full"
          >
            {connect.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying &amp; connecting…</>
            ) : (
              <><CheckCircle2 className="mr-2 h-4 w-4" />Connect Twilio</>
            )}
          </Button>

          {connect.isError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs">{(connect.error as any)?.message || 'Connection failed'}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----- Setup-guide presentation helpers -----

type Accent = 'indigo' | 'blue' | 'purple' | 'emerald';

const accentMap: Record<
  Accent,
  { gradient: string; text: string; ring: string; iconBg: string; border: string }
> = {
  indigo: {
    gradient: 'from-indigo-500 to-indigo-600',
    text: 'text-indigo-600 dark:text-indigo-400',
    ring: 'ring-indigo-500/20',
    iconBg: 'bg-indigo-100 dark:bg-indigo-950/50',
    border: 'border-l-indigo-500',
  },
  blue: {
    gradient: 'from-sky-500 to-blue-600',
    text: 'text-blue-600 dark:text-blue-400',
    ring: 'ring-blue-500/20',
    iconBg: 'bg-blue-100 dark:bg-blue-950/50',
    border: 'border-l-blue-500',
  },
  purple: {
    gradient: 'from-purple-500 to-fuchsia-600',
    text: 'text-purple-600 dark:text-purple-400',
    ring: 'ring-purple-500/20',
    iconBg: 'bg-purple-100 dark:bg-purple-950/50',
    border: 'border-l-purple-500',
  },
  emerald: {
    gradient: 'from-emerald-500 to-teal-600',
    text: 'text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500/20',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950/50',
    border: 'border-l-emerald-500',
  },
};

function Step({
  num,
  icon,
  accent,
  title,
  subtitle,
  body,
}: {
  num: number;
  icon: React.ReactNode;
  accent: Accent;
  title: string;
  subtitle?: string;
  body: React.ReactNode;
}) {
  const a = accentMap[accent];
  return (
    <div
      className={`relative rounded-xl border border-border border-l-4 ${a.border} bg-background/70 backdrop-blur-sm p-4 shadow-sm hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start gap-3">
        {/* Step number badge with icon overlay */}
        <div className="relative shrink-0">
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${a.gradient} flex items-center justify-center text-white shadow-lg ring-4 ${a.ring}`}
          >
            {icon}
          </div>
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-background border-2 border-border flex items-center justify-center text-[10px] font-bold text-foreground">
            {num}
          </div>
        </div>

        {/* Title + body */}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-semibold text-foreground text-[15px] leading-tight">
              {title}
            </p>
            {subtitle && (
              <span className={`text-xs font-medium ${a.text}`}>{subtitle}</span>
            )}
          </div>
          <div className="text-sm text-foreground/80 mt-2 leading-relaxed">{body}</div>
        </div>
      </div>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline inline-flex items-center gap-0.5 font-medium transition-colors"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-indigo-500 dark:text-indigo-400 mt-0.5 shrink-0">•</span>
      <span className="text-foreground/80">{children}</span>
    </li>
  );
}

function BulletCheck({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
      <span className="text-foreground/80">{children}</span>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 bg-muted text-foreground rounded text-xs font-mono border border-border">
      {children}
    </code>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="text-foreground font-semibold">{children}</strong>;
}

function Tip({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-muted/60 border border-border/60">
      <span className="text-base leading-none mt-0.5">{icon}</span>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

type CalloutTone = 'amber' | 'blue' | 'neutral';

const calloutToneMap: Record<
  CalloutTone,
  { bg: string; border: string; iconBg: string; iconText: string; titleText: string }
> = {
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900/60',
    iconBg: 'bg-amber-100 dark:bg-amber-900/50',
    iconText: 'text-amber-700 dark:text-amber-400',
    titleText: 'text-amber-900 dark:text-amber-200',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-900/60',
    iconBg: 'bg-blue-100 dark:bg-blue-900/50',
    iconText: 'text-blue-700 dark:text-blue-400',
    titleText: 'text-blue-900 dark:text-blue-200',
  },
  neutral: {
    bg: 'bg-muted/40 dark:bg-muted/20',
    border: 'border-border',
    iconBg: 'bg-muted dark:bg-muted/60',
    iconText: 'text-muted-foreground',
    titleText: 'text-foreground',
  },
};

function Callout({
  tone,
  icon,
  title,
  children,
}: {
  tone: CalloutTone;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const t = calloutToneMap[tone];
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} p-3.5`}>
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-lg ${t.iconBg} ${t.iconText} flex items-center justify-center shrink-0`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${t.titleText}`}>{title}</p>
          <p className={`text-xs mt-1 ${t.titleText} opacity-90 leading-relaxed`}>
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}

export default TwilioSmsSettings;
