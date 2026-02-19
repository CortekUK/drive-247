'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Lock, Mail, MessageSquare, MessageCircle, Save, Loader2, Info, FileText } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useLockboxTemplates } from '@/hooks/use-lockbox-templates';
import { useRentalSettings } from '@/hooks/use-rental-settings';

const DEFAULT_LOCKBOX_INSTRUCTIONS = `1. Go to the vehicle location
2. Locate the lockbox (check the vehicle-specific instructions if provided)
3. Enter the lockbox code to unlock
4. Retrieve the vehicle keys from inside
5. Close and lock the lockbox after retrieving the keys
6. Do not share the lockbox code with anyone

If you have any issues accessing the lockbox, please contact us immediately.`;

const AVAILABLE_VARIABLES = [
  { key: '{{customer_name}}', desc: 'Customer full name' },
  { key: '{{vehicle_name}}', desc: 'Vehicle make & model' },
  { key: '{{vehicle_reg}}', desc: 'Vehicle registration' },
  { key: '{{lockbox_code}}', desc: 'Lockbox access code' },
  { key: '{{lockbox_instructions}}', desc: 'Vehicle-specific lockbox location' },
  { key: '{{default_instructions}}', desc: 'Default lockbox instructions (from above)' },
  { key: '{{delivery_address}}', desc: 'Delivery address' },
  { key: '{{booking_ref}}', desc: 'Booking reference' },
  { key: '{{odometer}}', desc: 'Odometer reading' },
  { key: '{{notes}}', desc: 'Collection notes' },
];

export function LockboxTemplatesSection() {
  const { settings: rentalSettings, updateSettings } = useRentalSettings();
  const { templates, isLoading, getEmailTemplate, getSmsTemplate, getWhatsAppTemplate, saveTemplate } = useLockboxTemplates();
  const lockboxEnabled = rentalSettings?.lockbox_enabled ?? false;

  const [instructions, setInstructions] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [whatsappBody, setWhatsappBody] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingSms, setSavingSms] = useState(false);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Load instructions from rental settings
  useEffect(() => {
    if (rentalSettings?.lockbox_default_instructions !== undefined) {
      setInstructions(rentalSettings.lockbox_default_instructions || DEFAULT_LOCKBOX_INSTRUCTIONS);
    }
  }, [rentalSettings?.lockbox_default_instructions]);

  // Load templates once when data is ready
  useEffect(() => {
    if (initialized || isLoading) return;

    const email = getEmailTemplate();
    setEmailSubject(email.subject);
    setEmailBody(email.body);

    const sms = getSmsTemplate();
    setSmsBody(sms.body);

    const whatsapp = getWhatsAppTemplate();
    setWhatsappBody(whatsapp.body);
    setInitialized(true);
  }, [templates, isLoading]);

  const handleSaveInstructions = async () => {
    setSavingInstructions(true);
    try {
      await updateSettings({ lockbox_default_instructions: instructions });
    } catch (err) {
      toast({ title: 'Failed to save instructions', variant: 'destructive' });
    } finally {
      setSavingInstructions(false);
    }
  };

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    try {
      await saveTemplate.mutateAsync({
        channel: 'email',
        subject: emailSubject,
        body: emailBody,
      });
      toast({ title: 'Email template saved' });
    } catch (err) {
      toast({ title: 'Failed to save email template', variant: 'destructive' });
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSaveSms = async () => {
    setSavingSms(true);
    try {
      await saveTemplate.mutateAsync({
        channel: 'sms',
        body: smsBody,
      });
      toast({ title: 'SMS template saved' });
    } catch (err) {
      toast({ title: 'Failed to save SMS template', variant: 'destructive' });
    } finally {
      setSavingSms(false);
    }
  };

  const handleSaveWhatsapp = async () => {
    setSavingWhatsapp(true);
    try {
      await saveTemplate.mutateAsync({
        channel: 'whatsapp',
        body: whatsappBody,
      });
      toast({ title: 'WhatsApp template saved' });
    } catch (err) {
      toast({ title: 'Failed to save WhatsApp template', variant: 'destructive' });
    } finally {
      setSavingWhatsapp(false);
    }
  };

  if (!lockboxEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Lockbox Notification Templates
          </CardTitle>
          <CardDescription>
            Enable lockbox in Bookings settings to configure notification templates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Lockbox notification templates let you customise the email and SMS messages sent to customers when their vehicle keys are placed in a lockbox.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          Lockbox Notification Templates
        </CardTitle>
        <CardDescription>
          Customise the messages sent to customers with their lockbox access code
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Available Variables */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Available Variables</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AVAILABLE_VARIABLES.map(v => (
              <Badge key={v.key} variant="outline" className="text-xs font-mono cursor-default" title={v.desc}>
                {v.key}
              </Badge>
            ))}
          </div>
        </div>

        {/* Default Lockbox Instructions */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h4 className="font-medium text-sm">Default Lockbox Instructions</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            These instructions are included in every lockbox notification (email, SMS, WhatsApp) to guide customers on how to use the lockbox.
          </p>
          <div className="space-y-2">
            <Textarea
              id="lockbox-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={8}
              className="text-sm"
              placeholder="Enter default lockbox instructions..."
            />
          </div>
          <Button
            onClick={handleSaveInstructions}
            disabled={savingInstructions}
            size="sm"
          >
            {savingInstructions ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Instructions
          </Button>
        </div>

        <div className="border-t" />

        {/* Email Template */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h4 className="font-medium text-sm">Email Template</h4>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-subject" className="text-xs text-muted-foreground">Subject</Label>
            <Input
              id="email-subject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Your Vehicle Keys - Lockbox Code"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-body" className="text-xs text-muted-foreground">Body</Label>
            <Textarea
              id="email-body"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              placeholder="Email body with {{variable}} placeholders..."
            />
          </div>
          <Button
            onClick={handleSaveEmail}
            disabled={savingEmail}
            size="sm"
          >
            {savingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Email Template
          </Button>
        </div>

        <div className="border-t" />

        {/* SMS Template */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-sm">SMS Template</h4>
            </div>
            <Badge variant="outline" className="text-xs">
              {smsBody.length} / 160 chars
            </Badge>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-body" className="text-xs text-muted-foreground">Message</Label>
            <Textarea
              id="sms-body"
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
              rows={3}
              className="font-mono text-sm"
              placeholder="SMS message with {{variable}} placeholders..."
            />
            <p className="text-xs text-muted-foreground">
              Keep under 160 characters for a single SMS. Variables will be replaced with actual values.
            </p>
          </div>
          <Button
            onClick={handleSaveSms}
            disabled={savingSms}
            size="sm"
          >
            {savingSms ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save SMS Template
          </Button>
        </div>

        <div className="border-t" />

        {/* WhatsApp Template */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <h4 className="font-medium text-sm">WhatsApp Template</h4>
          </div>
          <div className="space-y-2">
            <Label htmlFor="whatsapp-body" className="text-xs text-muted-foreground">Message</Label>
            <Textarea
              id="whatsapp-body"
              value={whatsappBody}
              onChange={(e) => setWhatsappBody(e.target.value)}
              rows={8}
              className="font-mono text-sm"
              placeholder="WhatsApp message with {{variable}} placeholders..."
            />
            <p className="text-xs text-muted-foreground">
              Use *text* for bold formatting. Photos, odometer reading, and notes are appended automatically when sent from the Key Handover section.
            </p>
          </div>
          <Button
            onClick={handleSaveWhatsapp}
            disabled={savingWhatsapp}
            size="sm"
          >
            {savingWhatsapp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save WhatsApp Template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
