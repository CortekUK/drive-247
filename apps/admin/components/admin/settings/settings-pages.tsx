'use client';

/**
 * The pages behind the settings index, one per `?tab=`. Each is a page header,
 * flat sections of rows, and — where something is edited — the one sticky save
 * bar. All three editable pages share the one `admin_settings` row through
 * `useAdminSettings`, so Save writes exactly what the old single page wrote.
 */

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { ForceLogoutAllControl } from '@/components/admin/ForceLogoutAllControl';
import { PlatformPushSettings } from '@/components/admin/PlatformPushSettings';
import { LandingVersionSwitch } from '@/components/admin/landing-version-switch';
import { SignupOtpSwitch } from '@/components/admin/signup-otp-switch';
import { NorthwindSiteVersionCard } from '@/components/admin/developer/northwind-site-version-card';
import { cn } from '@/lib/utils';
import {
  SETTINGS_COLUMN,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsStickySaveBar,
} from './settings-kit';
import { useAdminSettings } from './use-admin-settings';

type SettingsState = ReturnType<typeof useAdminSettings>;

/** A page that edits the `admin_settings` row: header, body, one save bar. */
function EditablePage({
  title,
  description,
  state,
  children,
}: {
  title: string;
  description: ReactNode;
  state: SettingsState;
  children: ReactNode;
}) {
  return (
    <div className={cn(SETTINGS_COLUMN, 'md:pt-2')}>
      <SettingsPageHeader title={title} description={description} />
      {state.loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : (
        <>
          {children}
          <SettingsStickySaveBar
            dirty={state.dirty}
            saving={state.saving}
            saved={state.saved}
            error={state.error}
            onSave={() => void state.save()}
            onReset={state.reset}
          />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Subscription access                                                         */
/* -------------------------------------------------------------------------- */

const GRACE_DAYS = [3, 7, 10, 14, 30];

export function SubscriptionSettingsPage() {
  const state = useAdminSettings();
  const { settings, update } = state;

  return (
    <EditablePage
      title="Subscription access"
      description="What a tenant sees when their subscription lapses or a payment fails. Applies to every tenant."
      state={state}
    >
      <SettingsSection title="Blocking dialog">
        <SettingsRow
          label="Hide the subscription blocker"
          description="When on, no tenant is shown the “Finish Setup” or subscription-expired blocking dialog. Their subscription, plans and billing are left exactly as they are."
          htmlFor="subscription-gate-disabled"
        >
          <Switch
            id="subscription-gate-disabled"
            checked={settings.subscription_gate_disabled}
            onCheckedChange={(v) => update({ subscription_gate_disabled: v })}
          />
        </SettingsRow>
      </SettingsSection>

      {/* Payment grace period — how long a tenant keeps access after a failed
          payment, before the blocking dialog. This used to be
          `const GRACE_DAYS = 7` in the portal, i.e. a deploy to change the
          moment a paying business loses its own bookings. */}
      <SettingsSection title="After a failed payment">
        <SettingsRow
          label="Payment grace period"
          description="How long a tenant keeps full access after a payment fails or an invoice goes unpaid. They see a warning and a Pay now action, never a countdown; once it ends the blocking dialog appears."
        >
          <Select
            value={String(settings.subscription_grace_days)}
            onValueChange={(v) => update({ subscription_grace_days: Number(v) })}
          >
            <SelectTrigger className="w-[180px]" aria-label="Payment grace period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRACE_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>
    </EditablePage>
  );
}

/* -------------------------------------------------------------------------- */
/* Contact form                                                                */
/* -------------------------------------------------------------------------- */

export function ContactFormSettingsPage() {
  const state = useAdminSettings();
  const { settings, update } = state;
  const [newEmail, setNewEmail] = useState('');

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

    update({ notification_emails: [...settings.notification_emails, email] });
    setNewEmail('');
  };

  const removeEmail = (emailToRemove: string) => {
    if (settings.notification_emails.length <= 1) {
      toast.error('At least one notification email is required');
      return;
    }
    update({ notification_emails: settings.notification_emails.filter((e) => e !== emailToRemove) });
  };

  return (
    <EditablePage
      title="Contact form"
      description="The contact form on drive-247.com, and who hears about it when somebody sends a message."
      state={state}
    >
      <SettingsSection title="Form">
        <SettingsRow
          label="Accept messages"
          description="When off, the contact form on the website is disabled."
          htmlFor="contact-form-enabled"
        >
          <Switch
            id="contact-form-enabled"
            checked={settings.contact_form_enabled}
            onCheckedChange={(v) => update({ contact_form_enabled: v })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Who is emailed"
        description="Each address here gets an email when a contact form is submitted. At least one is required."
      >
        {settings.notification_emails.map((email) => (
          <SettingsRow key={email} label={email}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeEmail(email)}
              disabled={settings.notification_emails.length <= 1}
            >
              Remove
            </Button>
          </SettingsRow>
        ))}
        <SettingsRow label="Add an address" htmlFor="contact-form-new-email" align="start">
          <div className="flex w-full gap-2">
            <Input
              id="contact-form-new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEmail()}
              placeholder="name@example.com"
              className="flex-1"
            />
            <Button variant="outline" onClick={addEmail} disabled={!newEmail.trim()}>
              Add
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </EditablePage>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile notifications                                                        */
/* -------------------------------------------------------------------------- */

/** Saves as you go — every change is written the moment it is made. */
export function NotificationsSettingsPage() {
  return (
    <div className={cn(SETTINGS_COLUMN, 'md:pt-2')}>
      <SettingsPageHeader
        title="Mobile notifications"
        description="A push on your phone when something happens on any tenant, even while this dashboard is closed. Changes save as you make them."
      />
      <PlatformPushSettings />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export function SessionsSettingsPage() {
  return (
    <div className={cn(SETTINGS_COLUMN, 'md:pt-2')}>
      <SettingsPageHeader
        title="Sessions"
        description="Actions here affect every tenant at once, and cannot be undone."
      />
      <SettingsSection title="Sign everyone out">
        <SettingsRow
          label="Force log out all users"
          description="Immediately signs out all portal staff and booking customers across every tenant. Super admins are not affected."
        >
          {/* Shared with the Feedbacks settings panel — one implementation,
              two render sites, so the confirmation ceremony can never drift
              between them. */}
          <ForceLogoutAllControl className="whitespace-nowrap" />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pages whose switches save the moment they change                            */
/* -------------------------------------------------------------------------- */

/** A page of switches that each save as they are flipped: no save bar. */
function InstantPage({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className={cn(SETTINGS_COLUMN, 'md:pt-2')}>
      <SettingsPageHeader title={title} description={description} />
      {children}
    </div>
  );
}

export function LandingSettingsPage() {
  return (
    <InstantPage
      title="Landing page"
      description="What drive-247.com shows. Changes save as you make them and show on the next page load."
    >
      <SettingsSection title="drive-247.com">
        <LandingVersionSwitch />
      </SettingsSection>
    </InstantPage>
  );
}

export function BookingSiteSettingsPage() {
  return (
    <InstantPage
      title="Northwind booking site"
      description="The canary tenant’s booking site and customer portal. No other tenant’s site can change from here."
    >
      <SettingsSection title="Version">
        <NorthwindSiteVersionCard />
      </SettingsSection>
    </InstantPage>
  );
}

export function SignupSettingsPage() {
  return (
    <InstantPage
      title="Email verification"
      description="How a new operator proves their email address during self-serve signup. Changes save as you make them."
    >
      <SettingsSection title="Self-serve signup">
        <SignupOtpSwitch />
      </SettingsSection>
    </InstantPage>
  );
}
