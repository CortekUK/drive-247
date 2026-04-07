'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Save, Loader2, CheckCircle2, AlertCircle, Unplug, Phone, Send, Plus, Trash2, RefreshCw, FileText, Copy, Check, ExternalLink } from 'lucide-react';
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
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function TwilioWhatsAppSettings() {
  const { tenant, refetchTenant } = useTenant();
  const { toast } = useToast();

  const isConnected = !!(tenant as any)?.integration_twilio_whatsapp;
  const currentNumber = (tenant as any)?.twilio_whatsapp_number || '';
  const hasTwilioSms = !!(tenant as any)?.integration_twilio_sms;

  const [whatsappNumber, setWhatsappNumber] = useState(currentNumber);
  const [isSaving, setIsSaving] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const webhookUrl = `${SUPABASE_URL}/functions/v1/twilio-inbound-whatsapp`;
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Template management state
  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('Lockbox Code Delivery');
  const [newTemplateBody, setNewTemplateBody] = useState(
    'Your vehicle is ready for collection.\n\nAccess code: {{lockbox_code}}\nVehicle: {{vehicle_info}}\nPickup: {{address}}\n\nPlease do not share this code with anyone. Contact us if you need help.'
  );
  const [newTemplateType, setNewTemplateType] = useState<'lockbox_code' | 'general'>('lockbox_code');
  const lockboxTemplateSid = (tenant as any)?.twilio_whatsapp_lockbox_template_sid || null;
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const hasGeneralTemplate = templates.some((t: any) => t.template_type === 'general' && t.approval_status === 'approved');
  const hasApprovedLockboxTemplate = hasGeneralTemplate; // General opener handles lockbox too
  const hasLockboxTemplate = hasGeneralTemplate;

  useEffect(() => {
    setWhatsappNumber((tenant as any)?.twilio_whatsapp_number || '');
  }, [(tenant as any)?.twilio_whatsapp_number]);

  const handleSave = async () => {
    if (!tenant?.id || !whatsappNumber.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('tenants')
        .update({
          twilio_whatsapp_number: whatsappNumber.trim(),
          integration_twilio_whatsapp: true,
        })
        .eq('id', tenant.id);

      if (error) throw error;
      await refetchTenant();
      toast({ title: 'WhatsApp Connected', description: `WhatsApp sender set to ${whatsappNumber.trim()}` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!tenant?.id) return;
    setIsSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('tenants')
        .update({
          twilio_whatsapp_number: null,
          integration_twilio_whatsapp: false,
        })
        .eq('id', tenant.id);

      if (error) throw error;
      setWhatsappNumber('');
      setShowDisconnect(false);
      await refetchTenant();
      toast({ title: 'WhatsApp Disconnected', description: 'WhatsApp sender has been removed.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!tenant?.id || !testPhone.trim()) return;
    setIsSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-tenant-whatsapp', {
        body: {
          tenantId: tenant.id,
          to: testPhone.trim(),
          body: testMessage.trim() || `Test WhatsApp message from ${(tenant as any)?.company_name || 'Drive247'}. If you received this, WhatsApp is working!`,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Test WhatsApp Sent', description: 'Check your phone for the test message.' });
      } else {
        throw new Error(data?.error || 'Failed to send');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSendingTest(false);
    }
  };

  const loadTemplates = async () => {
    if (!tenant?.id) return;
    setIsLoadingTemplates(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: { action: 'list', tenantId: tenant?.id },
      });
      if (error) throw error;
      setTemplates(data?.templates || []);
    } catch (err: any) {
      console.error('Failed to load templates:', err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  useEffect(() => {
    if (isConnected && tenant?.id) loadTemplates();
  }, [isConnected, tenant?.id]);

  const handleCreateTemplate = async () => {
    if (!tenant?.id || !newTemplateName.trim() || !newTemplateBody.trim()) return;
    setIsCreatingTemplate(true);
    try {
      const variables = newTemplateType === 'lockbox_code'
        ? ['lockbox_code', 'vehicle_info', 'address']
        : ['company_name'];
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: {
          action: 'create',
          tenantId: tenant?.id,
          friendlyName: newTemplateName.trim(),
          bodyText: newTemplateBody.trim(),
          variables,
          templateType: newTemplateType,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Template Created', description: 'Template submitted to Meta for approval. This usually takes a few minutes for utility templates.' });
        setShowCreateTemplate(false);
        await refetchTenant();
        await loadTemplates();
      } else {
        throw new Error(data?.error || 'Failed to create template');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const handleCheckStatus = async (templateId: string) => {
    setLoadingTemplateId(templateId);
    try {
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: { action: 'check_status', templateId, tenantId: tenant?.id },
      });
      if (error) throw error;
      toast({
        title: `Status: ${data?.status || 'unknown'}`,
        description: data?.rejectionReason ? `Reason: ${data.rejectionReason}` : 'Template status updated.',
      });
      await loadTemplates();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    setDeletingTemplateId(templateId);
    try {
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: { action: 'delete', templateId, tenantId: tenant?.id },
      });
      if (error) throw error;
      toast({ title: 'Template Deleted' });
      await refetchTenant();
      await loadTemplates();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingTemplateId(null);
    }
  };

  if (!hasTwilioSms) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <svg className="h-5 w-5 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.612l4.458-1.495A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.319 0-4.476-.67-6.313-1.822l-.44-.264-2.645.887.887-2.645-.264-.44A9.952 9.952 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
                WhatsApp Business
              </CardTitle>
              <CardDescription>Send WhatsApp messages to customers via Twilio</CardDescription>
            </div>
            <Badge variant="secondary">Not Connected</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Set up Twilio SMS first. WhatsApp uses your Twilio account to send messages. Go to the SMS tab to configure Twilio.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <svg className="h-5 w-5 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.612l4.458-1.495A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.319 0-4.476-.67-6.313-1.822l-.44-.264-2.645.887.887-2.645-.264-.44A9.952 9.952 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
                WhatsApp Business
              </CardTitle>
              <CardDescription>Send WhatsApp messages to customers via Twilio</CardDescription>
            </div>
            {isConnected ? (
              <Badge className="bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
              </Badge>
            ) : (
              <Badge variant="secondary">Not Connected</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 border rounded-lg bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
                <Phone className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">WhatsApp sender active</p>
                  <p className="text-xs text-green-600 dark:text-green-400">{currentNumber}</p>
                </div>
              </div>

              {/* Webhook Setup — Required for receiving customer replies */}
              <div className="p-4 rounded-lg border space-y-3">
                <h4 className="font-medium text-sm">Receive Customer Replies</h4>
                <p className="text-xs text-muted-foreground">
                  To receive WhatsApp replies from customers in the Messages tab, you need to set the webhook URL in your Twilio console. This is a one-time setup per WhatsApp number.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Webhook URL</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={webhookUrl}
                        className="font-mono text-xs bg-muted/50"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          navigator.clipboard.writeText(webhookUrl);
                          setCopiedWebhook(true);
                          setTimeout(() => setCopiedWebhook(false), 2000);
                        }}
                      >
                        {copiedWebhook ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 space-y-2">
                    <p className="text-xs font-medium">How to set this up:</p>
                    <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
                      <li>Go to <strong>Twilio Console</strong> → Messaging → WhatsApp Senders</li>
                      <li>Click on your sender number (<strong>{currentNumber}</strong>)</li>
                      <li>Under <strong>"Endpoint Configuration"</strong>, set the webhook URL above for <strong>"A message comes in"</strong></li>
                      <li>Set the method to <strong>POST</strong></li>
                      <li>Click <strong>Save</strong></li>
                    </ol>
                    <p className="text-xs text-muted-foreground mt-2">
                      Once configured, customer replies on WhatsApp will appear in your Messages tab in real-time.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Update WhatsApp Number</Label>
                <div className="flex gap-2">
                  <Input
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+447863772592"
                    className="max-w-xs font-mono"
                  />
                  <Button
                    onClick={handleSave}
                    disabled={isSaving || whatsappNumber.trim() === currentNumber}
                    size="sm"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Update
                  </Button>
                </div>
              </div>
              {/* Send Test WhatsApp */}
              <div className="p-4 rounded-lg border space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Send Test WhatsApp
                </h4>
                <div className="space-y-2">
                  <Input
                    placeholder="Enter phone number with country code"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="font-mono"
                  />
                  <textarea
                    placeholder="Enter your message (optional — a default test message will be sent if left empty)"
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  />
                </div>
                <Button onClick={handleSendTest} disabled={!testPhone.trim() || isSendingTest} className="w-full">
                  {isSendingTest ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</> : <><Send className="mr-2 h-4 w-4" />Send Test WhatsApp</>}
                </Button>
              </div>

              {/* Message Templates */}
              <div className="p-4 rounded-lg border space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Message Templates
                  </h4>
                </div>

                <p className="text-xs text-muted-foreground">
                  WhatsApp requires pre-approved message templates to send messages to customers who haven't messaged you first. Create a template below — it will be submitted to Meta for approval.
                </p>
                <div className="p-3 rounded-lg bg-muted/30 space-y-1.5">
                  <p className="text-xs font-medium">Template guidelines (to avoid rejection):</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    <li>Keep messages <strong>transactional</strong> — related to an existing booking or action</li>
                    <li>No promotional language (no offers, discounts, or upsells)</li>
                    <li>No URLs in the message body</li>
                    <li>Use variables like {'{{lockbox_code}}'} — they get replaced with real values when sent</li>
                    <li>Don't put variables at the very start or end of the message</li>
                    <li>Each template name must be unique — old rejected names can't be reused</li>
                  </ul>
                </div>

                {hasGeneralTemplate && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <p className="text-sm text-green-800 dark:text-green-300">
                      Templates active — you can send WhatsApp messages to any customer, including lockbox codes, without requiring them to message you first.
                    </p>
                  </div>
                )}

                {!hasGeneralTemplate && !showCreateTemplate && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => {
                      setNewTemplateType('general');
                      setNewTemplateName('Conversation Opener');
                      setNewTemplateBody('Hi, you have a new message from {{company_name}} regarding your booking. Please reply to this message to continue.');
                      setShowCreateTemplate(true);
                    }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Create Template
                    </Button>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        No message template configured. Without it, you can only WhatsApp customers who have messaged you first. Create a template to message any customer — it also enables seamless lockbox code delivery.
                      </p>
                    </div>
                  </>
                )}

                {/* Create template form */}
                {showCreateTemplate && (
                  <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Template Name</Label>
                      <Input
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        placeholder="Lockbox Code Delivery"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Message Body</Label>
                      <textarea
                        value={newTemplateBody}
                        onChange={(e) => setNewTemplateBody(e.target.value)}
                        rows={3}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                      />
                      <p className="text-xs text-muted-foreground">
                        Available variables: {'{{lockbox_code}}'}, {'{{vehicle_info}}'}, {'{{address}}'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleCreateTemplate} disabled={isCreatingTemplate || !newTemplateName.trim() || !newTemplateBody.trim()} size="sm">
                        {isCreatingTemplate ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                        Submit for Approval
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowCreateTemplate(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Existing templates */}
                {templates.length > 0 && (
                  <div className="space-y-2">
                    {templates.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="space-y-0.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{t.friendly_name}</p>
                            <Badge variant={t.approval_status === 'approved' ? 'default' : t.approval_status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
                              {t.approval_status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{t.body}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCheckStatus(t.id)} disabled={loadingTemplateId === t.id} title="Check approval status">
                            {loadingTemplateId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteTemplate(t.id)} disabled={deletingTemplateId === t.id} title="Delete template">
                            {deletingTemplateId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowDisconnect(true)}>
                <Unplug className="h-4 w-4 mr-1.5" />
                Disconnect WhatsApp
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your Twilio WhatsApp sender number. This must be a number registered as a WhatsApp sender in your Twilio console.
              </p>
              <div className="space-y-2">
                <Label>WhatsApp Sender Number</Label>
                <Input
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  placeholder="+447863772592"
                  className="max-w-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Must include country code (e.g. +44 for UK, +1 for US). Register this number as a WhatsApp sender in your Twilio console first.
                </p>
              </div>
              <Button onClick={handleSave} disabled={isSaving || !whatsappNumber.trim()}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Connect WhatsApp
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your WhatsApp sender number. Lockbox codes and other notifications will no longer be sent via WhatsApp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
