'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  MessageSquare,
  Smartphone,
  Mail,
  PhoneCall,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Unplug,
  Phone,
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
import { TwilioSmsSettings } from './twilio-sms-settings';
import { TwilioWhatsAppSettings } from './twilio-whatsapp-settings';
import { useTwilioSms } from '@/hooks/use-twilio-sms';
import { useTwilioVoice } from '@/hooks/use-twilio-voice';
import { useTenant } from '@/contexts/TenantContext';

interface CommunicationSettingsProps {
  onBack?: () => void;
}

function ChannelStatusBadge({ status }: { status: 'active' | 'pending' | 'not_configured' }) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-200 text-xs">Pending</Badge>;
    case 'not_configured':
      return <Badge variant="secondary" className="text-xs">Not Set Up</Badge>;
  }
}

export function CommunicationSettings({ onBack }: CommunicationSettingsProps = {}) {
  const [activeChannel, setActiveChannel] = useState('sms');
  const { status: twilioStatus } = useTwilioSms();
  const { status: voiceStatus, isLoading: voiceLoading, setup: voiceSetup, disable: voiceDisable } = useTwilioVoice();
  const { tenant } = useTenant();
  const whatsappConnected = !!(tenant as any)?.integration_twilio_whatsapp;

  const [showDisableVoiceWarning, setShowDisableVoiceWarning] = useState(false);

  const smsStatus = twilioStatus?.isConfigured
    ? 'active'
    : twilioStatus?.hasSubaccount
    ? 'pending'
    : 'not_configured';

  return (
    <div className="space-y-6">
      {/* Header with optional back button */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div>
          <h3 className="text-lg font-semibold text-foreground">Communication Channels</h3>
          <p className="text-sm text-muted-foreground">
            Configure how you communicate with customers — SMS, WhatsApp, Email, and Calling.
          </p>
        </div>
      </div>

      <Tabs value={activeChannel} onValueChange={setActiveChannel}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="sms" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            <span className="hidden sm:inline">SMS</span>
            {smsStatus === 'active' && <CheckCircle2 className="h-3 w-3 text-green-600" />}
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">WhatsApp</span>
            {whatsappConnected && <CheckCircle2 className="h-3 w-3 text-green-600" />}
          </TabsTrigger>
          <TabsTrigger value="email" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Email</span>
            <CheckCircle2 className="h-3 w-3 text-green-600" />
          </TabsTrigger>
          <TabsTrigger value="calling" className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            <span className="hidden sm:inline">Calling</span>
            {voiceStatus?.isEnabled && <CheckCircle2 className="h-3 w-3 text-green-600" />}
          </TabsTrigger>
        </TabsList>

        {/* SMS Tab */}
        <TabsContent value="sms" className="mt-6">
          <TwilioSmsSettings />
        </TabsContent>

        {/* WhatsApp Tab */}
        <TabsContent value="whatsapp" className="mt-6 space-y-6">
          <TwilioWhatsAppSettings />
        </TabsContent>

        {/* Email Tab */}
        <TabsContent value="email" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                Email
                <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>
              </CardTitle>
              <CardDescription>
                Send emails to your customers directly from the Messages page via the Email channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-4 rounded-lg border bg-muted/50">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Email is active and ready to use. Select the <strong>Email</strong> channel in the Messages page to send emails to customers.</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Emails are sent via Resend using your tenant's configured sender address. The customer's email must be on file — you can add or edit it directly in the chat header when the Email channel is selected.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calling Tab */}
        <TabsContent value="calling" className="mt-6">
          {voiceLoading ? (
            <Card>
              <CardContent className="p-6 flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading voice status...</span>
              </CardContent>
            </Card>
          ) : voiceStatus?.isEnabled ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PhoneCall className="h-5 w-5 text-amber-600" />
                  Voice Calling
                  <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>
                </CardTitle>
                <CardDescription>
                  Browser-based calling is enabled. Make and receive calls directly from the Messages page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status overview */}
                <div className="p-4 rounded-lg border bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-medium text-green-800 dark:text-green-300">Voice Calling Active</h4>
                      <p className="text-sm text-green-700 dark:text-green-400">
                        You can make and receive browser-based calls. Select the <strong>Call</strong> channel in the Messages page to dial a customer.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Status details */}
                <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                  <h4 className="font-medium text-sm">Configuration Status</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      {voiceStatus.hasTwimlApp ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                      <span>TwiML Application</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {voiceStatus.hasApiKey ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                      <span>API Key</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {voiceStatus.webhookConfigured ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                      <span>Webhook Configured</span>
                    </div>
                    {twilioStatus?.capabilities?.voice && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        <span>Number supports voice</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Voice capability warning */}
                {twilioStatus?.isConfigured && twilioStatus?.capabilities && !twilioStatus.capabilities.voice && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        <strong>Note:</strong> Your current SMS number ({twilioStatus.phoneNumber}) does not support voice. Outbound calls will work, but customers cannot call back to this number. Consider upgrading to a voice-capable number in the SMS settings.
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Calls are made through your browser using WebRTC. Your Twilio number is used as the caller ID. The customer must have a phone number on file.
                </p>

                {/* Disable button */}
                <Button
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
                  onClick={() => setShowDisableVoiceWarning(true)}
                >
                  <Unplug className="mr-2 h-4 w-4" />
                  Disable Voice Calling
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PhoneCall className="h-5 w-5 text-amber-600" />
                  Voice Calling
                </CardTitle>
                <CardDescription>
                  Enable browser-based calling to make and receive calls directly from the Messages page without leaving your browser.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* SMS required notice */}
                {!twilioStatus?.isConfigured && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        <strong>SMS setup required:</strong> Voice calling requires an active Twilio SMS configuration with a phone number. Please set up SMS first in the SMS tab.
                      </p>
                    </div>
                  </div>
                )}

                {/* Feature explanation */}
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0 dark:bg-amber-900/30 dark:text-amber-400">
                      <Phone className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Browser-based calls</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Make and receive calls directly in your browser. No phone app or softphone needed.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0 dark:bg-amber-900/30 dark:text-amber-400">
                      <PhoneCall className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Uses your Twilio number</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Calls display your business phone number as the caller ID. Customers can call back to the same number.</p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => voiceSetup.mutate()}
                  disabled={voiceSetup.isPending || !twilioStatus?.isConfigured}
                  className="w-full"
                >
                  {voiceSetup.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting up...</>
                  ) : (
                    <><PhoneCall className="mr-2 h-4 w-4" />Enable Browser Calling</>
                  )}
                </Button>

                {!twilioStatus?.isConfigured && (
                  <p className="text-xs text-muted-foreground text-center">
                    Complete SMS setup in the SMS tab first to enable voice calling.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Disable Voice Warning Dialog */}
          <AlertDialog open={showDisableVoiceWarning} onOpenChange={setShowDisableVoiceWarning}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Unplug className="h-5 w-5 text-red-600" />
                  Disable Voice Calling?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will disable browser-based calling. You will no longer be able to make or receive calls from the Messages page. You can re-enable it at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    voiceDisable.mutate();
                    setShowDisableVoiceWarning(false);
                  }}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Yes, Disable
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CommunicationSettings;
