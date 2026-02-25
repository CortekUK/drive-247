'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';

interface AdminSettings {
  id?: string;
  notification_emails: string[];
  contact_form_enabled: boolean;
  updated_at?: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings>({
    notification_emails: ['ilyasghulam35@gmail.com'],
    contact_form_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  // Force logout state
  const [showGlobalLogoutConfirm, setShowGlobalLogoutConfirm] = useState(false);
  const [globalLogoutConfirmText, setGlobalLogoutConfirmText] = useState('');
  const [globalLogoutLoading, setGlobalLogoutLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned
        throw error;
      }

      if (data) {
        setSettings({
          id: data.id,
          notification_emails: data.notification_emails || ['ilyasghulam35@gmail.com'],
          contact_form_enabled: data.contact_form_enabled ?? true,
          updated_at: data.updated_at,
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Use defaults
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (settings.id) {
        // Update existing
        const { error } = await supabase
          .from('admin_settings')
          .update({
            notification_emails: settings.notification_emails,
            contact_form_enabled: settings.contact_form_enabled,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('admin_settings')
          .insert({
            notification_emails: settings.notification_emails,
            contact_form_enabled: settings.contact_form_enabled,
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

    // Validate email format
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
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-dark-card rounded w-48 mb-4"></div>
          <div className="h-4 bg-dark-card rounded w-96 mb-8"></div>
          <div className="h-64 bg-dark-card rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-2 text-gray-400">Configure admin dashboard settings</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Notification Emails */}
        <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
          <h2 className="text-xl font-semibold text-white mb-2">Notification Emails</h2>
          <p className="text-sm text-gray-400 mb-4">
            These email addresses will receive notifications when a contact form is submitted.
          </p>

          <div className="space-y-3 mb-4">
            {settings.notification_emails.map((email, index) => (
              <div
                key={email}
                className="flex items-center justify-between bg-dark-bg rounded-lg px-4 py-3 border border-dark-border"
              >
                <span className="text-gray-300">{email}</span>
                <button
                  onClick={() => removeEmail(email)}
                  className="text-red-400 hover:text-red-300 text-sm font-medium"
                  disabled={settings.notification_emails.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex space-x-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEmail()}
              placeholder="Add email address"
              className="flex-1 px-4 py-2 bg-dark-bg border border-dark-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={addEmail}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
            >
              Add
            </button>
          </div>
        </div>

        {/* Contact Form Settings */}
        <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
          <h2 className="text-xl font-semibold text-white mb-2">Contact Form</h2>
          <p className="text-sm text-gray-400 mb-4">
            Control whether the contact form on the website is enabled.
          </p>

          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={settings.contact_form_enabled}
                onChange={(e) => setSettings({ ...settings, contact_form_enabled: e.target.checked })}
                className="sr-only"
              />
              <div className={`w-14 h-8 rounded-full transition-colors ${
                settings.contact_form_enabled ? 'bg-primary-600' : 'bg-dark-border'
              }`}>
                <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform ${
                  settings.contact_form_enabled ? 'translate-x-6' : ''
                }`}></div>
              </div>
            </div>
            <span className="ml-3 text-gray-300">
              {settings.contact_form_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {settings.updated_at && (
          <p className="text-xs text-gray-500 text-right">
            Last updated: {new Date(settings.updated_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>
        )}

        {/* Danger Zone */}
        <div className="bg-dark-card rounded-lg overflow-hidden border border-red-800/50 mt-8">
          <div className="px-6 py-4 border-b border-dark-border">
            <h2 className="text-xl font-semibold text-red-400">Danger Zone</h2>
            <p className="text-sm text-gray-400 mt-1">Destructive actions that affect all tenants</p>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-medium">Force Logout All Users</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Immediately sign out all portal staff and booking customers across every tenant.
                  Super admins will not be affected.
                </p>
              </div>
              <button
                onClick={() => setShowGlobalLogoutConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium whitespace-nowrap ml-4"
              >
                Force Logout All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Global Force Logout Confirmation Modal */}
      {showGlobalLogoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-card rounded-lg p-6 max-w-md w-full border border-dark-border">
            <h2 className="text-xl font-bold text-white mb-2">Force Logout ALL Users</h2>
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-400">
                This will immediately sign out <strong>every portal staff member</strong> and{' '}
                <strong>every booking customer</strong> across all tenants on the platform.
              </p>
              <p className="text-sm text-red-400 mt-2">
                Super admins will not be affected.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Type <strong className="text-white">LOGOUT ALL</strong> to confirm:
              </label>
              <input
                type="text"
                value={globalLogoutConfirmText}
                onChange={(e) => setGlobalLogoutConfirmText(e.target.value)}
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="LOGOUT ALL"
              />
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => { setShowGlobalLogoutConfirm(false); setGlobalLogoutConfirmText(''); }}
                className="flex-1 px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleGlobalForceLogout}
                disabled={globalLogoutLoading || globalLogoutConfirmText !== 'LOGOUT ALL'}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {globalLogoutLoading ? 'Logging out...' : 'Force Logout Everyone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
