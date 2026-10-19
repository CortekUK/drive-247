'use client';

/**
 * /portal/settings — the customer's own details.
 *
 * Ported from `apps/booking/src/app/(customer-portal)/portal/settings/page.tsx`.
 * Same tables, same columns, same rules; re-skinned on the v2 palette. What is
 * deliberately DIFFERENT from v1, and why:
 *
 *  1. WRITES ARE SCOPED BY TENANT AS WELL AS BY ID, and a write that matches no
 *     row is an error rather than a success. Both live in
 *     `use-customer-settings.ts` — read its header before changing a query.
 *
 *  2. THE "CURRENT PASSWORD" FIELD IS GONE. v1 collects it, never checks it,
 *     and then calls `auth.updateUser({ password })` — which authenticates on
 *     the SESSION, not on that box. A field that implies a check nobody
 *     performs is worse than no field: it tells the customer their old password
 *     is a barrier when it is not. If real re-authentication is wanted, it
 *     belongs in Supabase's `secure_password_change` setting, not in the form.
 *
 *  3. SAVE IS DISABLED UNTIL SOMETHING CHANGED. v1's is always live, so every
 *     visit can fire an UPDATE against `customers` that writes the same values
 *     back.
 *
 *  4. DATE OF BIRTH AND ID EXPIRY ARE SCOPED TO THE TENANT TOO, and they are
 *     shown as read-only PLATES rather than as disabled inputs — they come from
 *     the scanned document, and a greyed-out text box reads as "broken", not as
 *     "not yours to edit".
 *
 * ── THE UNMOUNT ─────────────────────────────────────────────────────────────
 * A password or email change emits `USER_UPDATED`, which makes
 * `(portal)/layout.tsx` swap this page for `PortalBoot` for a few hundred
 * milliseconds. Anything that must be visible afterwards is parked in
 * `sessionStorage` — see `_components/sticky-notice.ts`.
 *
 * ── THE LAYOUT ──────────────────────────────────────────────────────────────
 * The operator portal v2's settings layout (`settings-v2/settings-kit`): flat
 * sections, a label column beside each control, soft hairlines between rows,
 * and ONE floating save bar for the page. Profile and notification
 * preferences are still two separate writes; the bar runs whichever of them is
 * dirty, so the customer only ever has one Save to find.
 */

import {
  AlertCircle,
  CheckCircle2,
  Info,
  KeyRound,
  Loader2,
  Mail,
} from 'lucide-react-nw';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { LoadError, PageHeader } from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import { Input } from '@nw/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@nw/components/ui/select';
import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import {
  useCustomerSettings,
  type CustomerSettings,
  type NotificationDraft,
  type ProfileDraft,
} from '@nw/hooks/use-customer-settings';
import { supabase } from '@nw/integrations/supabase/client';
import { todayDateString } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';

import {
  ChangeEmailDialog,
  ChangePasswordDialog,
} from './_components/account-dialogs';
import {
  PV_BUTTON_OUTLINE_SM,
  PV_INPUT,
  PV_SELECT_ITEM,
  PV_SELECT_TRIGGER,
} from './_components/pv-kit';
import {
  ReadOnlyValue,
  RowHint,
  SettingsRow,
  SettingsSaveBar,
  SettingsSection,
  SettingsSkeleton,
  StatusPill,
  SwitchRow,
} from './_components/settings-ui';
import { takeNotice, type Notice, type NoticeTone } from './_components/sticky-notice';
import { US_STATES } from './_data/us-states';
import {
  TIMEZONE_GROUPS,
  detectTimezone,
  resolveTimezoneLabel,
  timezoneOffsetLabel,
} from './_data/timezones';

/* ──────────────────────────── draft helpers ────────────────────────────── */

const PROFILE_FIELDS = [
  'name',
  'phone',
  'timezone',
  'addressStreet',
  'addressCity',
  'addressState',
  'addressZip',
  'licenseNumber',
  'licenseState',
] as const satisfies readonly (keyof ProfileDraft)[];

function toProfileDraft(settings: CustomerSettings): ProfileDraft {
  return {
    name: settings.name,
    phone: settings.phone,
    timezone: settings.timezone,
    addressStreet: settings.addressStreet,
    addressCity: settings.addressCity,
    addressState: settings.addressState,
    addressZip: settings.addressZip,
    licenseNumber: settings.licenseNumber,
    licenseState: settings.licenseState,
  };
}

function sameProfile(a: ProfileDraft, b: ProfileDraft): boolean {
  return PROFILE_FIELDS.every((field) => a[field] === b[field]);
}

function toNotificationDraft(settings: CustomerSettings): NotificationDraft {
  return {
    smsConsent: settings.smsConsent,
    whatsappOptIn: settings.whatsappOptIn,
  };
}

function sameNotifications(a: NotificationDraft, b: NotificationDraft): boolean {
  return a.smsConsent === b.smsConsent && a.whatsappOptIn === b.whatsappOptIn;
}

/**
 * A form draft that tracks the server row WITHOUT ever discarding unsaved
 * typing.
 *
 * The naive `useEffect(() => setDraft(fromServer), [row])` overwrites whatever
 * is in the box every time React Query hands back a new object — a background
 * refetch, a save in the neighbouring panel — so a half-typed address vanishes
 * mid-sentence. This adopts the server's version only when the local draft is
 * still identical to the last one that came down, i.e. when there is nothing to
 * lose.
 */
function useTrackedDraft<T>(
  /**
   * MUST be referentially stable while the server row is unchanged — memoise it
   * at the call site. A fresh object every render would re-run the effect
   * below, whose `setBaseline` would render again, forever.
   */
  source: T | null,
  isEqual: (a: T, b: T) => boolean,
): [T | null, Dispatch<SetStateAction<T | null>>, boolean] {
  const [draft, setDraft] = useState<T | null>(null);
  const baselineRef = useRef<T | null>(null);
  const [baseline, setBaseline] = useState<T | null>(null);

  useEffect(() => {
    if (source === null) return;

    const previousBaseline = baselineRef.current;
    baselineRef.current = source;
    setBaseline(source);

    setDraft((current) => {
      if (current === null || previousBaseline === null) return source;
      // Untouched since the last server value → adopt the new one. Edited →
      // keep the edit; the customer is mid-sentence.
      return isEqual(current, previousBaseline) ? source : current;
    });
    // `isEqual` is a module-level function and stable; listing it would only
    // add noise. `source` is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const dirty =
    draft !== null && baseline !== null && !isEqual(draft, baseline);

  return [draft, setDraft, dirty];
}

/** Shows "Saved" for a few seconds, then goes quiet. */
function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(() => {
    setSaved(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 4000);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return [saved, flash];
}

/* ─────────────────────────────── the page ──────────────────────────────── */

const SETTINGS_FORM_ID = 'portal-settings-form';

export default function PortalSettingsPage() {
  const { tenant } = useTenant();
  const { user } = useCustomerAuth();
  const { email: customerEmail } = useCustomer();
  const {
    settings,
    isLoading,
    isError,
    error,
    refetch,
    identity,
    identityLoading,
    saveProfile,
    isSavingProfile,
    saveNotifications,
    isSavingNotifications,
  } = useCustomerSettings();

  /* ── notices ──────────────────────────────────────────────────────────── */

  const [notice, setNotice] = useState<Notice | null>(null);

  // On mount, not during render: reading `sessionStorage` while rendering would
  // make the server and client HTML disagree and blow up hydration.
  useEffect(() => {
    const parked = takeNotice();
    if (parked) setNotice(parked);
  }, []);

  /* ── drafts ───────────────────────────────────────────────────────────── */

  // Memoised on `settings`, which React Query keeps referentially stable until
  // the row genuinely changes. See the note on `useTrackedDraft`'s `source`.
  const serverProfile = useMemo(
    () => (settings ? toProfileDraft(settings) : null),
    [settings],
  );
  const serverNotifications = useMemo(
    () => (settings ? toNotificationDraft(settings) : null),
    [settings],
  );

  const [profile, setProfile, profileDirty] = useTrackedDraft(
    serverProfile,
    sameProfile,
  );
  const [notifications, setNotifications, notificationsDirty] = useTrackedDraft(
    serverNotifications,
    sameNotifications,
  );

  const [profileSaved, flashProfileSaved] = useSavedFlash();
  const [notificationsSaved, flashNotificationsSaved] = useSavedFlash();
  const [saveError, setSaveError] = useState<string | null>(null);

  const setProfileField = useCallback(
    <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) => {
      setProfile((current) =>
        current === null ? current : { ...current, [field]: value },
      );
    },
    [setProfile],
  );

  const onSaveProfile = useCallback(async () => {
    if (!profile) return;
    setSaveError(null);
    try {
      await saveProfile(profile);
      flashProfileSaved();
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : 'We could not save your changes.',
      );
    }
  }, [profile, saveProfile, flashProfileSaved]);

  const onSaveNotifications = useCallback(async () => {
    if (!notifications) return;
    setSaveError(null);
    try {
      await saveNotifications(notifications);
      flashNotificationsSaved();
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : 'We could not save your preferences.',
      );
    }
  }, [notifications, saveNotifications, flashNotificationsSaved]);

  /*
    ONE save for the page. Profile first, then preferences, each only if it
    changed; each handler reports its own failure through `saveError` and the
    other still runs, so a refused address does not silently drop a switch.
  */
  const [savingAll, setSavingAll] = useState(false);
  const onSaveAll = useCallback(async () => {
    setSavingAll(true);
    try {
      if (profileDirty) await onSaveProfile();
      if (notificationsDirty) await onSaveNotifications();
    } finally {
      setSavingAll(false);
    }
  }, [profileDirty, notificationsDirty, onSaveProfile, onSaveNotifications]);

  const onResetAll = useCallback(() => {
    setSaveError(null);
    if (serverProfile) setProfile(serverProfile);
    if (serverNotifications) setNotifications(serverNotifications);
  }, [serverProfile, serverNotifications, setProfile, setNotifications]);

  /* ── account (auth.users) ─────────────────────────────────────────────── */

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [resending, setResending] = useState(false);

  /*
    The address that actually signs in is `auth.users.email`. `customers.email`
    is a copy, and it is NOT rewritten when a change is confirmed, so it can lag
    — showing that copy here would tell somebody their old address still works.
  */
  const signInEmail = user?.email ?? customerEmail ?? '';
  const emailVerified = user?.email_confirmed_at != null;
  const pendingEmail = user?.new_email ?? null;

  const resendVerification = useCallback(async () => {
    if (signInEmail === '') return;
    setResending(true);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: signInEmail,
    });
    setResending(false);
    setNotice(
      resendError
        ? {
            tone: 'danger',
            message:
              resendError.message || 'We could not send that email. Try again shortly.',
          }
        : {
            tone: 'info',
            message: `We have sent a new verification link to ${signInEmail}.`,
          },
    );
  }, [signInEmail]);

  /* ── derived display values ───────────────────────────────────────────── */

  const brandName =
    tenant?.company_name ?? tenant?.app_name ?? 'this rental company';
  // v1 gates the SMS consent row on this flag for A2P 10DLC reasons: an
  // operator with no SMS sender must not be shown collecting consent to send.
  const smsAvailable = tenant?.integration_twilio_sms === true;

  const today = todayDateString();
  const documentExpiry = identity?.documentExpiry ?? null;
  const documentExpired =
    documentExpiry !== null && documentExpiry.slice(0, 10) < today;

  // The customer's DOB lives on `customers` once verification has written it
  // back, and on the verification row before that. Either is the same fact.
  const dateOfBirth = settings?.dateOfBirth ?? identity?.dateOfBirth ?? null;

  const suggestedTimezone = useMemo(() => detectTimezone(), []);

  /* ── render ───────────────────────────────────────────────────────────── */

  const nameMissing = profile !== null && profile.name.trim() === '';

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        description="Your details, how we reach you, and how you sign in."
      />

      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}

      {!emailVerified && signInEmail !== '' ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-pv-warning-light px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-pv-warning" />
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-pv-fg">
                Your email is not verified yet
              </p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">
                Booking confirmations and rental agreements go to{' '}
                <span className="break-all">{signInEmail}</span>. Verify it so they
                reach you.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={resending}
            aria-busy={resending}
            onClick={() => void resendVerification()}
            className={cn(PV_BUTTON_OUTLINE_SM, 'w-full shrink-0 sm:w-auto')}
          >
            {resending ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Resend link'
            )}
          </Button>
        </div>
      ) : null}

      {isError ? (
        <LoadError
          title="We could not load your details"
          error={error}
          onRetry={refetch}
        />
      ) : null}

      {saveError ? <Banner tone="danger">{saveError}</Banner> : null}

      {isLoading ? <SettingsSkeleton /> : null}

      {!isLoading && !isError && settings === null ? (
        <LoadError
          title="We could not find your account on this site"
          error={
            new Error(
              'Your sign-in worked, but there is no customer record for this operator. Please contact support so we can link it.',
            )
          }
          onRetry={refetch}
        />
      ) : null}

      {!isLoading && settings !== null && profile !== null ? (
        <>
          {/* One form for everything editable: Enter in any field saves, and
              the floating bar's Save is this form's submit button (bound by
              `form=`, since the bar sits at the foot of the page). */}
          <form
            id={SETTINGS_FORM_ID}
            onSubmit={(event) => {
              event.preventDefault();
              if (nameMissing) return;
              void onSaveAll();
            }}
            className="flex flex-col gap-12"
          >
            {/* ── Your details ───────────────────────────────────────────── */}
            <SettingsSection
              id="settings-details"
              title="Your details"
              description="How we address you, and how we reach you about a booking."
            >
              <SettingsRow
                label="Full name"
                description="As it appears on your driving licence."
                htmlFor="settings-name"
              >
                <Input
                  id="settings-name"
                  value={profile.name}
                  onChange={(event) => setProfileField('name', event.target.value)}
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  aria-required
                  aria-invalid={nameMissing || undefined}
                  aria-describedby={nameMissing ? 'settings-name-error' : undefined}
                  className={cn(PV_INPUT, 'max-w-md')}
                />
                {nameMissing ? (
                  <RowHint tone="danger" id="settings-name-error">
                    Please enter your name.
                  </RowHint>
                ) : null}
              </SettingsRow>

              <SettingsRow
                label="Phone"
                description="Used to fill in your booking forms, and to reach you on the day."
                htmlFor="settings-phone"
              >
                <Input
                  id="settings-phone"
                  type="tel"
                  inputMode="tel"
                  value={profile.phone}
                  onChange={(event) => setProfileField('phone', event.target.value)}
                  autoComplete="tel"
                  placeholder="+1 555 000 0000"
                  className={cn(PV_INPUT, 'max-w-md')}
                />
              </SettingsRow>

              {/*
                Read-only, and from a different source: these two are what the
                scanned document said. They are shown here because a customer
                whose licence is about to expire needs to see it somewhere other
                than at the counter.
              */}
              <SettingsRow
                label="Date of birth"
                description={
                  dateOfBirth ? (
                    <span className="inline-flex items-center gap-1.5 text-pv-success">
                      <CheckCircle2 aria-hidden className="size-3.5" />
                      From your verified ID
                    </span>
                  ) : (
                    'Set when you complete ID verification.'
                  )
                }
              >
                <ReadOnlyValue
                  value={
                    identityLoading && dateOfBirth === null ? (
                      <span className="text-pv-muted-fg">Checking…</span>
                    ) : dateOfBirth ? (
                      (formatDate(dateOfBirth.slice(0, 10)) ?? dateOfBirth)
                    ) : (
                      <span className="text-pv-muted-fg">Not on file</span>
                    )
                  }
                />
              </SettingsRow>

              <SettingsRow
                label="ID document expiry"
                description={
                  documentExpired
                    ? 'Renew your document and verify it again before your next rental.'
                    : documentExpiry
                      ? 'From your verified ID.'
                      : 'Set when you complete ID verification.'
                }
              >
                <ReadOnlyValue
                  value={
                    identityLoading && documentExpiry === null ? (
                      <span className="text-pv-muted-fg">Checking…</span>
                    ) : documentExpiry ? (
                      (formatDate(documentExpiry.slice(0, 10)) ?? documentExpiry)
                    ) : (
                      <span className="text-pv-muted-fg">Not on file</span>
                    )
                  }
                  badge={
                    documentExpiry ? (
                      <StatusPill tone={documentExpired ? 'negative' : 'positive'}>
                        {documentExpired ? 'Expired' : 'Valid'}
                      </StatusPill>
                    ) : undefined
                  }
                />
              </SettingsRow>

              <SettingsRow
                label="Timezone"
                description="Pickup and return times are shown in this zone."
                htmlFor="settings-timezone"
              >
                <Select
                  value={profile.timezone === '' ? undefined : profile.timezone}
                  onValueChange={(value) => setProfileField('timezone', value)}
                >
                  <SelectTrigger
                    id="settings-timezone"
                    className={cn(PV_SELECT_TRIGGER, 'max-w-md')}
                  >
                    {/*
                      The children override what `SelectValue` would render from
                      the chosen item, so a stored zone this list does not carry
                      still shows as itself rather than as a placeholder over a
                      non-empty column.
                    */}
                    <SelectValue placeholder="Choose your timezone">
                      {profile.timezone === ''
                        ? undefined
                        : resolveTimezoneLabel(profile.timezone)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-2xl">
                    {TIMEZONE_GROUPS.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel className="text-xs text-pv-muted-fg">
                          {group.label}
                        </SelectLabel>
                        {group.timezones.map((zone) => (
                          <SelectItem
                            key={zone.value}
                            value={zone.value}
                            className={PV_SELECT_ITEM}
                          >
                            {timezoneOffsetLabel(zone)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {profile.timezone === '' && suggestedTimezone !== null ? (
                  <RowHint>
                    Your device says{' '}
                    <button
                      type="button"
                      onClick={() => setProfileField('timezone', suggestedTimezone)}
                      className="rounded-sm font-medium text-pv-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-pv-primary/25"
                    >
                      {resolveTimezoneLabel(suggestedTimezone)}
                    </button>
                    .
                  </RowHint>
                ) : null}
              </SettingsRow>
            </SettingsSection>

            {/* ── Address & licence ────────────────────────────────────── */}
            <SettingsSection
              id="settings-address"
              title="Address & licence"
              description="Used to fill in insurance and rental paperwork for you. Only the operator handling your rental sees these."
            >
              <SettingsRow label="Street address" htmlFor="settings-address-street">
                <Input
                  id="settings-address-street"
                  value={profile.addressStreet}
                  onChange={(event) => setProfileField('addressStreet', event.target.value)}
                  autoComplete="address-line1"
                  placeholder="123 Main Street"
                  className={cn(PV_INPUT, 'max-w-xl')}
                />
              </SettingsRow>

              <SettingsRow label="City, state and ZIP code">
                <div className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                  <Input
                    id="settings-address-city"
                    aria-label="City"
                    value={profile.addressCity}
                    onChange={(event) => setProfileField('addressCity', event.target.value)}
                    autoComplete="address-level2"
                    placeholder="City"
                    className={cn(PV_INPUT, 'col-span-2 sm:col-span-1')}
                  />
                  <StateField
                    id="settings-address-state"
                    label="State"
                    value={profile.addressState}
                    onChange={(value) => setProfileField('addressState', value)}
                  />
                  <Input
                    id="settings-address-zip"
                    aria-label="ZIP code"
                    value={profile.addressZip}
                    onChange={(event) =>
                      setProfileField('addressZip', event.target.value.slice(0, 10))
                    }
                    autoComplete="postal-code"
                    placeholder="ZIP"
                    className={PV_INPUT}
                  />
                </div>
              </SettingsRow>

              <SettingsRow
                label="Driver's licence"
                description="The number, and the state that issued it."
              >
                <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <Input
                    id="settings-license-number"
                    aria-label="Driver's licence number"
                    value={profile.licenseNumber}
                    onChange={(event) => setProfileField('licenseNumber', event.target.value)}
                    placeholder="L1234567"
                    className={PV_INPUT}
                  />
                  <StateField
                    id="settings-license-state"
                    label="Licence state"
                    value={profile.licenseState}
                    onChange={(value) => setProfileField('licenseState', value)}
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            {/* ── Notifications ──────────────────────────────────────────── */}
            {notifications !== null ? (
              <SettingsSection
                id="settings-messages"
                title="Messages about your rental"
                description="Confirmations and collection details always go to your email. These are the extras."
              >
                {smsAvailable ? (
                  <SwitchRow
                    id="settings-sms-consent"
                    checked={notifications.smsConsent}
                    onChange={(checked) =>
                      setNotifications({ ...notifications, smsConsent: checked })
                    }
                    title="Text messages (SMS)"
                    description={
                      <>
                        Booking confirmations, collection and lockbox details and
                        e-signing links from {brandName}. Message &amp; data rates may
                        apply; message frequency varies. Reply STOP to opt out, HELP for
                        help. Consent is not a condition of rental.
                        {settings.smsConsentAt && settings.smsConsent ? (
                          <span className="mt-1 block">
                            {/*
                              `sms_consent_at` is a timestamptz, not a date
                              column, so it goes through `formatTimestamp` —
                              `formatDate` would put it through `parseDateOnly`,
                              the wrong parser for a value with a real instant.
                            */}
                            You agreed on{' '}
                            {formatTimestamp(settings.smsConsentAt) ?? settings.smsConsentAt}.
                          </span>
                        ) : null}
                      </>
                    }
                  />
                ) : null}

                <SwitchRow
                  id="settings-whatsapp-opt-in"
                  checked={notifications.whatsappOptIn}
                  onChange={(checked) =>
                    setNotifications({ ...notifications, whatsappOptIn: checked })
                  }
                  title="WhatsApp"
                  description={`Let ${brandName} send collection details and signing links to your phone number on WhatsApp instead of by text.`}
                />

                {profile.phone.trim() === '' &&
                (notifications.smsConsent || notifications.whatsappOptIn) ? (
                  <RowHint tone="warning">
                    Add a phone number above so we have somewhere to send these.
                  </RowHint>
                ) : null}
              </SettingsSection>
            ) : null}

          </form>

          {/* ── Sign-in & security ─────────────────────────────────────── */}
          {/* Outside the form: these open dialogs and save nothing here. */}
          <SettingsSection
            id="settings-security"
            title="Sign-in & security"
            description="The address and password you use to get into this portal."
          >
            <SettingsRow
              label="Email address"
              description={
                pendingEmail ? (
                  <span className="text-pv-warning">
                    A change to {pendingEmail} is waiting for you to open the
                    confirmation link.
                  </span>
                ) : (
                  'Where every booking confirmation is sent.'
                )
              }
            >
              <ReadOnlyValue
                value={signInEmail === '' ? '—' : signInEmail}
                badge={
                  emailVerified ? (
                    <StatusPill tone="positive">Verified</StatusPill>
                  ) : (
                    <StatusPill tone="notice">Not verified</StatusPill>
                  )
                }
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEmailDialogOpen(true)}
                    disabled={signInEmail === ''}
                    className={PV_BUTTON_OUTLINE_SM}
                  >
                    <Mail aria-hidden className="size-4" />
                    Change
                  </Button>
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Password"
              description="Changing it signs you in with the new password from next time."
            >
              <ReadOnlyValue
                value={
                  <span
                    aria-label="Password hidden"
                    className="tracking-[0.3em] text-pv-muted-fg"
                  >
                    ••••••••
                  </span>
                }
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPasswordDialogOpen(true)}
                    className={PV_BUTTON_OUTLINE_SM}
                  >
                    <KeyRound aria-hidden className="size-4" />
                    Change
                  </Button>
                }
              />
            </SettingsRow>
          </SettingsSection>

          {/* Last on the page so it sticks to the foot of the whole scroll, and
              takes no room between sections while it is hidden. */}
          <SettingsSaveBar
            formId={SETTINGS_FORM_ID}
            dirty={profileDirty || notificationsDirty}
            saving={savingAll || isSavingProfile || isSavingNotifications}
            saved={profileSaved || notificationsSaved}
            onReset={onResetAll}
          />

          <ChangePasswordDialog
            open={passwordDialogOpen}
            onOpenChange={setPasswordDialogOpen}
          />
          <ChangeEmailDialog
            open={emailDialogOpen}
            onOpenChange={setEmailDialogOpen}
            currentEmail={signInEmail}
          />
        </>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────── banner ───────────────────────────────── */

/** A page-level notice in the v2 tints — the operator's inline alert. */
function Banner({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? AlertCircle : Info;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px] leading-relaxed',
        tone === 'success' && 'bg-pv-success-light text-pv-success',
        tone === 'danger' && 'bg-pv-danger-light text-pv-danger',
        tone === 'info' && 'bg-pv-tint text-pv-fg',
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{children}</p>
    </div>
  );
}

/* ──────────────────────────── state picker ─────────────────────────────── */

/**
 * Two of these on the page — address and licence — so it is one component.
 * Labelled by `aria-label`: it shares its row with the fields beside it, and
 * the row's label names the group.
 *
 * There is no "clear" item: Radix reserves the empty string as its own
 * "nothing selected" sentinel and rejects it as an item value. Once a state is
 * chosen it can be swapped but not blanked, which matches v1 and is the lesser
 * problem — the alternative is a sentinel value that could reach the column.
 */
function StateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value === '' ? undefined : value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className={PV_SELECT_TRIGGER}>
        <SelectValue placeholder="State" />
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-2xl">
        {US_STATES.map((state) => (
          <SelectItem key={state.value} value={state.value} className={PV_SELECT_ITEM}>
            {state.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
