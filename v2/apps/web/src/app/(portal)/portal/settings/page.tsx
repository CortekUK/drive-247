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
 */

import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { FormNotice } from '@/app/(auth)/_components/auth-fields';
import {
  FIELD_TRIGGER_CLASS,
  FieldGrid,
  FieldHint,
  FieldLabel,
  SELECT_ITEM_CLASS,
  TextField,
} from '@/components/booking/field-primitives';
import { formatDate, formatTimestamp } from '@/components/portal/format';
import { LoadError, PageHeader } from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomer } from '@/hooks/use-customer';
import {
  useCustomerSettings,
  type CustomerSettings,
  type NotificationDraft,
  type ProfileDraft,
} from '@/hooks/use-customer-settings';
import { supabase } from '@/integrations/supabase/client';
import { todayDateString } from '@/lib/domain';

import {
  ChangeEmailDialog,
  ChangePasswordDialog,
} from './_components/account-dialogs';
import {
  ReadOnlyField,
  SaveFooter,
  SettingsPanel,
  SettingsSkeleton,
  StatusPill,
  SwitchRow,
} from './_components/settings-ui';
import { takeNotice, type Notice } from './_components/sticky-notice';
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Account settings"
        description="Your details, how we reach you, and how you sign in."
      />

      {notice ? <FormNotice tone={notice.tone}>{notice.message}</FormNotice> : null}

      {!emailVerified && signInEmail !== '' ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-warning-med/40 bg-warning-light px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle
              aria-hidden
              strokeWidth={1.75}
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-text">
                Your email is not verified yet
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">
                Booking confirmations and rental agreements go to{' '}
                <span className="break-all">{signInEmail}</span>. Verify it so
                they reach you.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="brand-outline"
            disabled={resending}
            aria-busy={resending}
            onClick={() => void resendVerification()}
            className="h-11 w-full shrink-0 sm:w-auto"
          >
            {resending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
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

      {saveError ? <FormNotice tone="danger">{saveError}</FormNotice> : null}

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
          {/* ── Your details ───────────────────────────────────────────── */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveProfile();
            }}
            className="flex flex-col gap-4"
          >
            <SettingsPanel
              icon={UserRound}
              title="Your details"
              description="How we address you, and how we reach you about a booking."
              footer={
                <SaveFooter
                  dirty={profileDirty}
                  saving={isSavingProfile}
                  saved={profileSaved}
                  hint="Everything you change on this page is saved together."
                />
              }
            >
              <div className="space-y-4">
                <FieldGrid>
                  <TextField
                    id="settings-name"
                    label="Full name"
                    value={profile.name}
                    onChange={(value) => setProfileField('name', value)}
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    required
                    error={
                      profile.name.trim() === ''
                        ? 'Please enter your name.'
                        : undefined
                    }
                  />
                  <TextField
                    id="settings-phone"
                    label="Phone"
                    type="tel"
                    inputMode="tel"
                    value={profile.phone}
                    onChange={(value) => setProfileField('phone', value)}
                    autoComplete="tel"
                    placeholder="+1 555 000 0000"
                    optional
                    hint="Used to fill in your booking forms, and to reach you on the day."
                  />
                </FieldGrid>

                {/*
                  Read-only, and from a different source: these two are what the
                  scanned document said. They are shown here because a customer
                  whose licence is about to expire needs to see it somewhere
                  other than at the counter.
                */}
                <FieldGrid>
                  <ReadOnlyField
                    label="Date of birth"
                    value={
                      identityLoading && dateOfBirth === null ? (
                        <span className="text-brand-text-subtle">Checking…</span>
                      ) : dateOfBirth ? (
                        (formatDate(dateOfBirth.slice(0, 10)) ?? dateOfBirth)
                      ) : (
                        <span className="text-brand-text-subtle">
                          Not on file
                        </span>
                      )
                    }
                    hint={
                      dateOfBirth ? (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <CheckCircle2 aria-hidden className="size-3.5" />
                          From your verified ID
                        </span>
                      ) : (
                        'Set when you complete ID verification.'
                      )
                    }
                  />
                  <ReadOnlyField
                    label="ID document expiry"
                    value={
                      identityLoading && documentExpiry === null ? (
                        <span className="text-brand-text-subtle">Checking…</span>
                      ) : documentExpiry ? (
                        (formatDate(documentExpiry.slice(0, 10)) ?? documentExpiry)
                      ) : (
                        <span className="text-brand-text-subtle">
                          Not on file
                        </span>
                      )
                    }
                    badge={
                      documentExpiry ? (
                        <StatusPill tone={documentExpired ? 'negative' : 'positive'}>
                          {documentExpired ? 'Expired' : 'Valid'}
                        </StatusPill>
                      ) : undefined
                    }
                    hint={
                      documentExpired
                        ? 'Renew your document and verify it again before your next rental.'
                        : documentExpiry
                          ? 'From your verified ID.'
                          : 'Set when you complete ID verification.'
                    }
                  />
                </FieldGrid>

                <div className="space-y-1.5 sm:max-w-sm">
                  <FieldLabel htmlFor="settings-timezone" optional>
                    Timezone
                  </FieldLabel>
                  <Select
                    value={profile.timezone === '' ? undefined : profile.timezone}
                    onValueChange={(value) => setProfileField('timezone', value)}
                  >
                    <SelectTrigger
                      id="settings-timezone"
                      className={FIELD_TRIGGER_CLASS}
                    >
                      <Globe
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-4 shrink-0 text-brand-text-subtle"
                      />
                      {/*
                        The children override what `SelectValue` would render
                        from the chosen item, so a stored zone this list does not
                        carry still shows as itself rather than as a placeholder
                        over a non-empty column.
                      */}
                      <SelectValue placeholder="Choose your timezone">
                        {profile.timezone === ''
                          ? undefined
                          : resolveTimezoneLabel(profile.timezone)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {TIMEZONE_GROUPS.map((group) => (
                        <SelectGroup key={group.label}>
                          <SelectLabel className="text-xs text-brand-text-subtle">
                            {group.label}
                          </SelectLabel>
                          {group.timezones.map((zone) => (
                            <SelectItem
                              key={zone.value}
                              value={zone.value}
                              className={SELECT_ITEM_CLASS}
                            >
                              {timezoneOffsetLabel(zone)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldHint>
                    Pickup and return times are shown in this zone.
                    {profile.timezone === '' && suggestedTimezone !== null ? (
                      <>
                        {' '}
                        Your device says{' '}
                        <button
                          type="button"
                          onClick={() =>
                            setProfileField('timezone', suggestedTimezone)
                          }
                          className="font-medium text-brand-text underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
                        >
                          {resolveTimezoneLabel(suggestedTimezone)}
                        </button>
                        .
                      </>
                    ) : null}
                  </FieldHint>
                </div>
              </div>
            </SettingsPanel>

            {/* ── Address & licence ────────────────────────────────────── */}
            <SettingsPanel
              icon={MapPin}
              title="Address & licence"
              description="Used to fill in insurance and rental paperwork for you."
              footer={
                <SaveFooter
                  dirty={profileDirty}
                  saving={isSavingProfile}
                  saved={profileSaved}
                  hint="Everything you change on this page is saved together."
                />
              }
            >
              <div className="space-y-4">
                <TextField
                  id="settings-address-street"
                  label="Street address"
                  value={profile.addressStreet}
                  onChange={(value) => setProfileField('addressStreet', value)}
                  autoComplete="address-line1"
                  placeholder="123 Main Street"
                  optional
                />

                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-3">
                  <TextField
                    id="settings-address-city"
                    label="City"
                    value={profile.addressCity}
                    onChange={(value) => setProfileField('addressCity', value)}
                    autoComplete="address-level2"
                    placeholder="Miami"
                    optional
                  />
                  <StateField
                    id="settings-address-state"
                    label="State"
                    value={profile.addressState}
                    onChange={(value) => setProfileField('addressState', value)}
                  />
                  <TextField
                    id="settings-address-zip"
                    label="ZIP code"
                    value={profile.addressZip}
                    onChange={(value) =>
                      setProfileField('addressZip', value.slice(0, 10))
                    }
                    autoComplete="postal-code"
                    placeholder="33101"
                    optional
                  />
                </div>

                <FieldGrid>
                  <TextField
                    id="settings-license-number"
                    label="Driver's licence number"
                    value={profile.licenseNumber}
                    onChange={(value) => setProfileField('licenseNumber', value)}
                    placeholder="L1234567"
                    optional
                  />
                  <StateField
                    id="settings-license-state"
                    label="Licence state"
                    value={profile.licenseState}
                    onChange={(value) => setProfileField('licenseState', value)}
                  />
                </FieldGrid>

                <FieldHint>
                  We never show these to anyone but the operator handling your
                  rental.
                </FieldHint>
              </div>
            </SettingsPanel>
          </form>

          {/* ── Notifications ──────────────────────────────────────────── */}
          {notifications !== null ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveNotifications();
              }}
            >
              <SettingsPanel
                icon={BellRing}
                title="Messages about your rental"
                description="Confirmations and collection details always go to your email. These are the extras."
                footer={
                  <SaveFooter
                    dirty={notificationsDirty}
                    saving={isSavingNotifications}
                    saved={notificationsSaved}
                    label="Save preferences"
                  />
                }
              >
                <div className="divide-y divide-brand-border-soft">
                  {smsAvailable ? (
                    <div className="pb-3">
                      <SwitchRow
                        id="settings-sms-consent"
                        checked={notifications.smsConsent}
                        onChange={(checked) =>
                          setNotifications({
                            ...notifications,
                            smsConsent: checked,
                          })
                        }
                        title="Text messages (SMS)"
                        description={
                          <>
                            Booking confirmations, collection and lockbox details
                            and e-signing links from {brandName}. Message &amp;
                            data rates may apply; message frequency varies. Reply
                            STOP to opt out, HELP for help. Consent is not a
                            condition of rental.
                          </>
                        }
                      />
                    </div>
                  ) : null}

                  <div className={smsAvailable ? 'pt-3' : undefined}>
                    <SwitchRow
                      id="settings-whatsapp-opt-in"
                      checked={notifications.whatsappOptIn}
                      onChange={(checked) =>
                        setNotifications({
                          ...notifications,
                          whatsappOptIn: checked,
                        })
                      }
                      title="WhatsApp"
                      description={`Let ${brandName} send collection details and signing links to your phone number on WhatsApp instead of by text.`}
                    />
                  </div>
                </div>

                {profile.phone.trim() === '' &&
                (notifications.smsConsent || notifications.whatsappOptIn) ? (
                  <p className="mt-3 text-xs leading-relaxed text-warning">
                    Add a phone number above so we have somewhere to send these.
                  </p>
                ) : null}

                {settings.smsConsentAt && settings.smsConsent ? (
                  <p className="mt-3 text-xs leading-relaxed text-brand-text-subtle">
                    {/*
                      `sms_consent_at` is a timestamptz, not a date column, so it
                      goes through `formatTimestamp` — `formatDate` would put it
                      through `parseDateOnly`, which is the wrong parser for a
                      value that carries a real instant.
                    */}
                    You agreed to text messages on{' '}
                    {formatTimestamp(settings.smsConsentAt) ?? settings.smsConsentAt}.
                  </p>
                ) : null}
              </SettingsPanel>
            </form>
          ) : null}

          {/* ── Sign-in & security ─────────────────────────────────────── */}
          <SettingsPanel
            icon={ShieldCheck}
            title="Sign-in & security"
            description="The address and password you use to get into this portal."
          >
            <div className="space-y-4">
              <ReadOnlyField
                label="Email address"
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
                    variant="brand-outline"
                    onClick={() => setEmailDialogOpen(true)}
                    disabled={signInEmail === ''}
                    className="h-11 w-full shrink-0 sm:w-auto"
                  >
                    <Mail aria-hidden strokeWidth={1.75} />
                    Change
                  </Button>
                }
                hint={
                  pendingEmail ? (
                    <span className="text-warning">
                      A change to {pendingEmail} is waiting for you to open the
                      confirmation link.
                    </span>
                  ) : (
                    'This is where every booking confirmation is sent.'
                  )
                }
              />

              <ReadOnlyField
                label="Password"
                value={
                  <span
                    aria-label="Password hidden"
                    className="tracking-[0.3em] text-brand-text-subtle"
                  >
                    ••••••••
                  </span>
                }
                action={
                  <Button
                    type="button"
                    variant="brand-outline"
                    onClick={() => setPasswordDialogOpen(true)}
                    className="h-11 w-full shrink-0 sm:w-auto"
                  >
                    <KeyRound aria-hidden strokeWidth={1.75} />
                    Change
                  </Button>
                }
                hint="Changing it here signs you in with the new password from next time."
              />
            </div>
          </SettingsPanel>

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

/* ──────────────────────────── state picker ─────────────────────────────── */

/**
 * Two of these on the page — address and licence — so it is one component.
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
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} optional>
        {label}
      </FieldLabel>
      <Select
        value={value === '' ? undefined : value}
        onValueChange={onChange}
      >
        <SelectTrigger id={id} className={FIELD_TRIGGER_CLASS}>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {US_STATES.map((state) => (
            <SelectItem
              key={state.value}
              value={state.value}
              className={SELECT_ITEM_CLASS}
            >
              {state.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
