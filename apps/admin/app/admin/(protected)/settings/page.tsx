'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { X, AlertTriangle } from 'lucide-react';

interface AdminSettings {
  id?: string;
  notification_emails: string[];
  contact_form_enabled: boolean;
  maintenance_banner_enabled: boolean;
  maintenance_banner_message: string;
  maintenance_banner_type: 'info' | 'warning' | 'critical';
  updated_at?: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings>({
    notification_emails: ['ilyasghulam35@gmail.com'],
    contact_form_enabled: true,
    maintenance_banner_enabled: false,
    maintenance_banner_message: 'We are currently performing scheduled maintenance. Some features may be temporarily unavailable.',
    maintenance_banner_type: 'warning',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  const [showGlobalLogoutConfirm, setShowGlobalLogoutConfirm] = useState(false);
  const [globalLogoutConfirmText, setGlobalLogoutConfirmText] = useState('');
  const [globalLogoutLoading, setGlobalLogoutLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data: rows, error } = await supabase
        .from('admin_settings')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;

      const data = rows?.[0];
      if (data) {
        setSettings({
          id: data.id,
          notification_emails: data.notification_emails || ['ilyasghulam35@gmail.com'],
          contact_form_enabled: data.contact_form_enabled ?? true,
          maintenance_banner_enabled: data.maintenance_banner_enabled ?? false,
          maintenance_banner_message: data.maintenance_banner_message || 'We are currently performing scheduled maintenance. Some features may be temporarily unavailable.',
          maintenance_banner_type: data.maintenance_banner_type || 'warning',
          updated_at: data.updated_at,
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (settings.id) {
        const { error } = await supabase
          .from('admin_settings')
          .update({
            notification_emails: settings.notification_emails,
            contact_form_enabled: settings.contact_form_enabled,
            maintenance_banner_enabled: settings.maintenance_banner_enabled,
            maintenance_banner_message: settings.maintenance_banner_message,
            maintenance_banner_type: settings.maintenance_banner_type,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settings.id);

        if (error) throw error;

        await supabase
          .from('admin_settings')
          .update({
            maintenance_banner_enabled: settings.maintenance_banner_enabled,
            maintenance_banner_message: settings.maintenance_banner_message,
            maintenance_banner_type: settings.maintenance_banner_type,
          })
          .neq('id', settings.id);
      } else {
        const { data, error } = await supabase
          .from('admin_settings')
          .insert({
            notification_emails: settings.notification_emails,
            contact_form_enabled: settings.contact_form_enabled,
            maintenance_banner_enabled: settings.maintenance_banner_enabled,
            maintenance_banner_message: settings.maintenance_banner_message,
            maintenance_banner_type: settings.maintenance_banner_type,
          })
          .select()
          .single();

        if (error) throw error;
        setSettings({ ...settings, id: data.id });
      }

      toast.success('Settings saved successfully');
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast.error(`Failed to save settings: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const addEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (settings.notification_emails.includes(email)) {
      toast.error('Email already in list');
      return;
    }

    setSettings({
      ...settings,
      notification_emails: [...settings.notification_emails, email],
    });
    setNewEmail('');
  };

  const removeEmail = (emailToRemove: string) => {
    if (settings.notification_emails.length <= 1) {
      toast.error('At least one notification email is required');
      return;
    }

    setSettings({
      ...settings,
      notification_emails: settings.notification_emails.filter(e => e !== emailToRemove),
    });
  };

  const handleGlobalForceLogout = async () => {
    if (globalLogoutConfirmText !== 'LOGOUT ALL') return;
    setGlobalLogoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-force-logout', {
        body: {}
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(
        `Successfully logged out ${data.successCount} user${data.successCount !== 1 ? 's' : ''} across all tenants`
      );
      if (data.failCount > 0) {
        toast.error(`${data.failCount} user${data.failCount !== 1 ? 's' : ''} could not be logged out`);
      }
      setShowGlobalLogoutConfirm(false);
      setGlobalLogoutConfirmText('');
    } catch (error: any) {
      toast.error(`Failed to force logout: ${error.message}`);
    } finally {
      setGlobalLogoutLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <div className="max-w-2xl space-y-4">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure admin dashboard settings</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Notification Emails */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notification Emails</CardTitle>
            <CardDescription>
              These email addresses will receive notifications when a contact form is submitted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {settings.notification_emails.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between rounded-md border px-4 py-2.5"
                >
                  <span className="text-sm">{email}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEmail(email)}
                    disabled={settings.notification_emails.length <= 1}
                    className="text-muted-foreground hover:text-destructive h-auto py-1 px-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addEmail()}
                placeholder="Add email address"
                className="flex-1"
              />
              <Button onClick={addEmail}>Add</Button>
            </div>
          </CardContent>
        </Card>

        {/* Maintenance Banner */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Maintenance Banner</CardTitle>
                <CardDescription className="mt-1">
                  Display a global maintenance banner across all tenant portals and booking sites.
                </CardDescription>
              </div>
              <label className="flex items-center cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={settings.maintenance_banner_enabled}
                    onChange={(e) => setSettings({ ...settings, maintenance_banner_enabled: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    "w-11 h-6 rounded-full transition-colors",
                    settings.maintenance_banner_enabled ? 'bg-amber-500' : 'bg-muted'
                  )}>
                    <div className={cn(
                      "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                      settings.maintenance_banner_enabled && 'translate-x-5'
                    )} />
                  </div>
                </div>
                <Badge
                  variant={settings.maintenance_banner_enabled ? 'warning' : 'outline'}
                  className="ml-2"
                >
                  {settings.maintenance_banner_enabled ? 'Active' : 'Inactive'}
                </Badge>
              </label>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-2 block">Severity Level</Label>
              <div className="flex gap-2">
                {(['info', 'warning', 'critical'] as const).map((type) => (
                  <Button
                    key={type}
                    variant={settings.maintenance_banner_type === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSettings({ ...settings, maintenance_banner_type: type })}
                    className={cn(
                      'flex-1 capitalize',
                      settings.maintenance_banner_type === type && type === 'info' && 'bg-blue-600 hover:bg-blue-700',
                      settings.maintenance_banner_type === type && type === 'warning' && 'bg-warning hover:bg-warning/90 text-warning-foreground',
                      settings.maintenance_banner_type === type && type === 'critical' && 'bg-destructive hover:bg-destructive/90'
                    )}
                  >
                    {type}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Banner Message</Label>
              <Textarea
                value={settings.maintenance_banner_message}
                onChange={(e) => setSettings({ ...settings, maintenance_banner_message: e.target.value })}
                rows={3}
                placeholder="Enter the maintenance message to display..."
              />
            </div>

            {settings.maintenance_banner_enabled && (
              <div>
                <Label className="mb-2 block">Preview</Label>
                <div className={cn(
                  "rounded-md px-4 py-3 text-sm font-medium border",
                  settings.maintenance_banner_type === 'info' && 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                  settings.maintenance_banner_type === 'warning' && 'bg-warning/10 border-warning/30 text-warning',
                  settings.maintenance_banner_type === 'critical' && 'bg-destructive/10 border-destructive/30 text-destructive'
                )}>
                  {settings.maintenance_banner_message}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contact Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Form</CardTitle>
            <CardDescription>
              Control whether the contact form on the website is enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-center cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.contact_form_enabled}
                  onChange={(e) => setSettings({ ...settings, contact_form_enabled: e.target.checked })}
                  className="sr-only"
                />
                <div className={cn(
                  "w-11 h-6 rounded-full transition-colors",
                  settings.contact_form_enabled ? 'bg-violet-500' : 'bg-muted'
                )}>
                  <div className={cn(
                    "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                    settings.contact_form_enabled && 'translate-x-5'
                  )} />
                </div>
              </div>
              <span className="ml-3 text-sm">
                {settings.contact_form_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex items-center justify-between">
          {settings.updated_at && (
            <p className="text-xs text-muted-foreground">
              Last updated: {new Date(settings.updated_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          )}
          <Button onClick={handleSave} disabled={saving} className="ml-auto">
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>

        <Separator />

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>Destructive actions that affect all tenants</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Force Logout All Users</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Immediately sign out all portal staff and booking customers across every tenant.
                  Super admins will not be affected.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowGlobalLogoutConfirm(true)}
                className="ml-4 whitespace-nowrap"
              >
                Force Logout All
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Global Force Logout Confirmation Dialog */}
      <Dialog open={showGlobalLogoutConfirm} onOpenChange={(open) => {
        if (!open) {
          setShowGlobalLogoutConfirm(false);
          setGlobalLogoutConfirmText('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force Logout ALL Users</DialogTitle>
            <DialogDescription>
              This will immediately sign out every portal staff member and every booking customer across all tenants on the platform. Super admins will not be affected.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4">
            <p className="text-sm text-destructive">
              This action cannot be undone. All users will need to sign in again.
            </p>
          </div>

          <div>
            <Label className="mb-2 block">
              Type <strong>LOGOUT ALL</strong> to confirm:
            </Label>
            <Input
              value={globalLogoutConfirmText}
              onChange={(e) => setGlobalLogoutConfirmText(e.target.value)}
              placeholder="LOGOUT ALL"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowGlobalLogoutConfirm(false); setGlobalLogoutConfirmText(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleGlobalForceLogout}
              disabled={globalLogoutLoading || globalLogoutConfirmText !== 'LOGOUT ALL'}
            >
              {globalLogoutLoading ? 'Logging out...' : 'Force Logout Everyone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
