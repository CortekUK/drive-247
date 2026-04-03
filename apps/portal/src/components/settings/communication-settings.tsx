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
} from 'lucide-react';
import { TwilioSmsSettings } from './twilio-sms-settings';
import { WhatsAppMetaSettings } from './whatsapp-meta-settings';
import { useTwilioSms } from '@/hooks/use-twilio-sms';
import { useTenant } from '@/contexts/TenantContext';

interface CommunicationSettingsProps {
  onBack: () => void;
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

export function CommunicationSettings({ onBack }: CommunicationSettingsProps) {
  const [activeChannel, setActiveChannel] = useState('sms');
  const { status: twilioStatus } = useTwilioSms();
  const { tenant } = useTenant();
  const whatsappConnected = !!(tenant as any)?.integration_whatsapp;

  const smsStatus = twilioStatus?.isConfigured
    ? 'active'
    : twilioStatus?.hasSubaccount
    ? 'pending'
    : 'not_configured';

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
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
            <CheckCircle2 className="h-3 w-3 text-green-600" />
          </TabsTrigger>
        </TabsList>

        {/* SMS Tab */}
        <TabsContent value="sms" className="mt-6">
          <TwilioSmsSettings />
        </TabsContent>

        {/* WhatsApp Tab */}
        <TabsContent value="whatsapp" className="mt-6 space-y-6">
          <WhatsAppMetaSettings />

          {/* Setup guide for tenants */}
          {!whatsappConnected && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">How to Set Up WhatsApp Business</CardTitle>
                <CardDescription>Follow these steps to connect your WhatsApp Business account</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#25D366]/10 text-[#25D366] flex items-center justify-center text-xs font-bold shrink-0">1</div>
                    <div>
                      <p className="text-sm font-medium">Create a Meta Business Account</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Go to business.facebook.com and create a business account if you don't have one. You'll need a business name, address, and website.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#25D366]/10 text-[#25D366] flex items-center justify-center text-xs font-bold shrink-0">2</div>
                    <div>
                      <p className="text-sm font-medium">Verify your business</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Meta requires business verification before you can use the WhatsApp Business API. This involves uploading business documents (takes 1-3 business days).</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#25D366]/10 text-[#25D366] flex items-center justify-center text-xs font-bold shrink-0">3</div>
                    <div>
                      <p className="text-sm font-medium">Have a phone number ready</p>
                      <p className="text-xs text-muted-foreground mt-0.5">You need a phone number that isn't already registered with WhatsApp. This number will become your business WhatsApp number. You can use your Twilio number if it supports voice (for OTP verification).</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#25D366]/10 text-[#25D366] flex items-center justify-center text-xs font-bold shrink-0">4</div>
                    <div>
                      <p className="text-sm font-medium">Click "Connect WhatsApp" above</p>
                      <p className="text-xs text-muted-foreground mt-0.5">You'll be guided through Meta's setup flow. This connects your WhatsApp Business account to Drive247 so you can send and receive messages from the Messages page.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#25D366]/10 text-[#25D366] flex items-center justify-center text-xs font-bold shrink-0">5</div>
                    <div>
                      <p className="text-sm font-medium">Create message templates (optional)</p>
                      <p className="text-xs text-muted-foreground mt-0.5">WhatsApp requires pre-approved templates for outbound messages to customers who haven't messaged you in the last 24 hours. You can create templates in Meta Business Suite → WhatsApp Manager → Message Templates.</p>
                    </div>
                  </div>

                  <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      <strong>Important:</strong> WhatsApp has a 24-hour messaging window. You can freely reply to customers who messaged you within the last 24 hours. Outside this window, you can only send pre-approved message templates.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneCall className="h-5 w-5 text-amber-600" />
                Voice Calling
                <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>
              </CardTitle>
              <CardDescription>
                Call your customers directly from the Messages page using click-to-call.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-4 rounded-lg border bg-muted/50">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Click-to-call is active. Select the <strong>Call</strong> channel in the Messages page to dial a customer's phone number using your device's phone app.</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                When you click Call in a conversation, your device's phone app (or desktop dialer) will open with the customer's number pre-filled. The customer must have a phone number on file. You can add or edit it in the SMS channel view.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CommunicationSettings;
