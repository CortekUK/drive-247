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
          <div className="rounded-lg border bg-[#f8fafc] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowGuide((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[#080812] hover:bg-[#f1f5f9] transition-colors"
            >
              <span className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-indigo-600" />
                How to set up your Twilio account
              </span>
              {showGuide ? (
                <ChevronUp className="h-4 w-4 text-[#737373]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[#737373]" />
              )}
            </button>
            {showGuide && (
              <div className="px-4 pb-4 pt-1 space-y-5 text-sm text-[#404040] border-t bg-white">
                <Step
                  num={1}
                  title="Create your Twilio account (skip if you already have one)"
                  body={
                    <div className="space-y-2">
                      <p>
                        Open{' '}
                        <a
                          href="https://www.twilio.com/try-twilio"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-medium"
                        >
                          twilio.com/try-twilio <ExternalLink className="h-3 w-3" />
                        </a>{' '}
                        in a new tab.
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-[#404040] ml-1">
                        <li>Sign up with your business email and a strong password.</li>
                        <li>Twilio will email you a confirmation link — click it.</li>
                        <li>Verify your mobile phone number when prompted (Twilio sends a one-time code).</li>
                        <li>
                          On the "Welcome to Twilio" walkthrough, the defaults are fine. You can
                          skip the "What do you want to build?" questionnaire — it doesn't affect
                          anything.
                        </li>
                        <li>
                          You'll land on the <strong>Twilio Console</strong> dashboard. That's
                          your home base.
                        </li>
                      </ul>
                      <p className="text-xs text-[#737373] pt-1">
                        💰 Free trial includes ~$15 of credit. No credit card required to start.
                      </p>
                    </div>
                  }
                />

                <Step
                  num={2}
                  title="Buy a phone number"
                  body={
                    <div className="space-y-2">
                      <p>
                        In the Twilio Console, open{' '}
                        <a
                          href="https://console.twilio.com/us1/develop/phone-numbers/manage/search"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-medium"
                        >
                          Phone Numbers → Manage → Buy a number{' '}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        .
                      </p>
                      <ul className="list-disc list-inside space-y-1 ml-1">
                        <li>
                          <strong>Country</strong> — pick your region (UK, US, etc.).
                        </li>
                        <li>
                          <strong>Capabilities</strong> — tick <strong>SMS</strong>. If you'll
                          use voice calling later too, also tick <strong>Voice</strong>.
                        </li>
                        <li>
                          Optionally type an <strong>area code</strong> if you want a specific
                          one.
                        </li>
                        <li>
                          Click <strong>Search</strong>.
                        </li>
                        <li>
                          Pick any number from the list and click the blue <strong>Buy</strong>{' '}
                          button next to it.
                        </li>
                        <li>
                          Confirm the purchase in the popup. Cost is about $1.15/month for US
                          numbers, £1/month for UK — comes out of your trial credit.
                        </li>
                      </ul>
                      <p>
                        Once bought, the number appears in{' '}
                        <a
                          href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-medium"
                        >
                          Active Numbers <ExternalLink className="h-3 w-3" />
                        </a>
                        . Copy it down — you'll need it in the form below in E.164 format (e.g.{' '}
                        <code className="px-1 py-0.5 bg-[#f1f5f9] rounded text-xs">
                          +14155551234
                        </code>
                        , with the leading <strong>+</strong> and country code).
                      </p>
                      <p className="text-xs text-[#737373] pt-1">
                        💡 Already have a number on your account? Skip the buy step — just go to
                        Active Numbers and grab the one you want to use.
                      </p>
                    </div>
                  }
                />

                <Step
                  num={3}
                  title="Copy your Account SID and Auth Token"
                  body={
                    <div className="space-y-2">
                      <p>
                        Go back to the{' '}
                        <a
                          href="https://console.twilio.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-medium"
                        >
                          Twilio Console homepage <ExternalLink className="h-3 w-3" />
                        </a>{' '}
                        (or click the Twilio logo in the top-left).
                      </p>
                      <ul className="list-disc list-inside space-y-1 ml-1">
                        <li>
                          Scroll down until you see a panel labeled{' '}
                          <strong>Account Info</strong>.
                        </li>
                        <li>
                          You'll see two values:
                          <ul className="list-disc list-inside ml-5 mt-1 space-y-1">
                            <li>
                              <strong>Account SID</strong> — a long string starting with{' '}
                              <code className="px-1 py-0.5 bg-[#f1f5f9] rounded text-xs">
                                AC
                              </code>{' '}
                              (always visible). Click the copy icon next to it.
                            </li>
                            <li>
                              <strong>Auth Token</strong> — hidden by default. Click the eye
                              icon or "Show" link to reveal it, then click the copy icon.
                            </li>
                          </ul>
                        </li>
                        <li>Paste both into the form below.</li>
                      </ul>
                      <div className="flex items-start gap-2 p-2.5 rounded bg-amber-50 border border-amber-200">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-900">
                          <strong>Treat the Auth Token like a password.</strong> Anyone with it
                          can send messages from your account and run up your bill. We store it
                          encrypted and never expose it back to your browser.
                        </p>
                      </div>
                    </div>
                  }
                />

                <Step
                  num={4}
                  title="Click Connect — we handle the rest"
                  body={
                    <div className="space-y-2">
                      <p>
                        Once all three fields below are filled, click{' '}
                        <strong>Connect Twilio</strong>. We'll automatically:
                      </p>
                      <ul className="list-disc list-inside space-y-1 ml-1">
                        <li>Verify your credentials with Twilio</li>
                        <li>Confirm the phone number exists on your account and supports SMS</li>
                        <li>Wire up inbound SMS webhooks on your number (so customer replies land in the Messages page)</li>
                        <li>Save everything securely</li>
                      </ul>
                      <p>
                        Takes about 5 seconds. You'll see a "Twilio Connected" confirmation when
                        it's done.
                      </p>
                    </div>
                  }
                />

                {/* Trial account caller verification — important gotcha */}
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-medium text-blue-900">
                      Trial accounts: verify your test number first
                    </p>
                  </div>
                  <p className="text-xs text-blue-900">
                    Twilio trial accounts can only send SMS to <strong>verified caller IDs</strong>.
                    Before you click "Send Test SMS" later, go to{' '}
                    <a
                      href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified"
                      target="_blank"
                      rel="noreferrer"
                      className="underline inline-flex items-center gap-0.5"
                    >
                      Phone Numbers → Verified Caller IDs{' '}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>{' '}
                    and add your own mobile number. Paid (upgraded) accounts skip this entirely.
                    This is a Twilio limitation, not a Drive247 one.
                  </p>
                </div>

                {/* US/Canada 10DLC note */}
                <div className="pt-2 border-t">
                  <p className="text-xs text-[#737373]">
                    <strong className="text-[#404040]">US / Canada numbers only:</strong> Twilio
                    requires 10DLC brand &amp; campaign registration for sending SMS to US or
                    Canadian recipients. SMS will work immediately for non-US/CA destinations,
                    but for US/CA you'll need to complete the one-time registration in your
                    Twilio console (under <em>Messaging → Regulatory Compliance</em>). It takes
                    about 15 minutes plus 1–7 days of carrier review.
                  </p>
                </div>
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

function Step({
  num,
  title,
  body,
}: {
  num: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold shrink-0">
        {num}
      </div>
      <div className="flex-1">
        <p className="font-medium text-[#080812] text-sm">{title}</p>
        <p className="text-sm text-[#404040] mt-0.5">{body}</p>
      </div>
    </div>
  );
}

export default TwilioSmsSettings;
