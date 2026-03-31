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
import { useTwilioSms } from '@/hooks/use-twilio-sms';

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
          </TabsTrigger>
          <TabsTrigger value="email" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Email</span>
          </TabsTrigger>
          <TabsTrigger value="calling" className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            <span className="hidden sm:inline">Calling</span>
          </TabsTrigger>
        </TabsList>

        {/* SMS Tab */}
        <TabsContent value="sms" className="mt-6">
          <TwilioSmsSettings />
        </TabsContent>

        {/* WhatsApp Tab */}
        <TabsContent value="whatsapp" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-green-600" />
                WhatsApp Business
                <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
              </CardTitle>
              <CardDescription>
                Send and receive WhatsApp messages with your customers directly from the Messages page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-6 rounded-lg border border-dashed border-border bg-muted/30 text-center">
                <MessageSquare className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                <h4 className="font-medium text-foreground mb-1">WhatsApp Integration</h4>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  WhatsApp Business API integration is coming soon. You'll be able to send booking confirmations,
                  reminders, and have two-way conversations with customers via WhatsApp — all within the same
                  unified message thread.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Tab */}
        <TabsContent value="email" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                Email
                <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
              </CardTitle>
              <CardDescription>
                Send and receive emails with your customers directly from the Messages page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-6 rounded-lg border border-dashed border-border bg-muted/30 text-center">
                <Mail className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                <h4 className="font-medium text-foreground mb-1">Email Integration</h4>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Email integration is coming soon. Customer emails will appear in the same unified conversation
                  thread alongside SMS and WhatsApp messages. You'll be able to reply to emails without leaving
                  the portal.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calling Tab */}
        <TabsContent value="calling" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneCall className="h-5 w-5 text-purple-600" />
                Voice Calling
                <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
              </CardTitle>
              <CardDescription>
                Make and receive phone calls with your customers directly from the portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-6 rounded-lg border border-dashed border-border bg-muted/30 text-center">
                <PhoneCall className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                <h4 className="font-medium text-foreground mb-1">Voice Calling</h4>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Voice calling is coming soon. You'll be able to make and receive calls using your business
                  phone number. Call logs will appear in the customer's conversation timeline.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CommunicationSettings;
