'use client';

/**
 * Settings → Details: who the customer is and where they live, on one page
 * (owner, Oct 21 2026 — "Address and license" folded in; one heading per page,
 * as the operator's settings pages).
 *
 *   Full name, phone, time zone and the address are the customer's to change,
 *   and save straight to their row — no email, no request.
 *   Date of birth (with the age it makes) and document expiry are read-only:
 *   they come from the verified ID, and are corrected on the Verification page
 *   if the scan read them wrong.
 *
 * The licence number moved to Verification: it is the document number there.
 *
 * Ported from v1's settings page; what differs and why lives in the hook's
 * header (`use-customer-settings.ts`): every write is scoped by id AND tenant,
 * a write that matches nothing is an error, Save is off until something
 * changed, and a background refetch never wipes what is being typed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { formatDate } from '@nw/components/portal/format';
import { LoadError } from '@nw/portal-v2/primitives';
import { Input } from '@nw/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nw/components/ui/select';
import { useCustomerSettings, type CustomerSettings, type ProfileDraft } from '@nw/hooks/use-customer-settings';
import { parseDateOnly, todayDateString } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';

import { PV_INPUT, PV_SELECT_ITEM, PV_SELECT_TRIGGER } from '../_components/pv-kit';
import {
  ReadOnlyValue,
  RowHint,
  SettingsPageHeader,
  SettingsRow,
  SettingsSaveBar,
  SettingsSkeleton,
  StatusPill,
} from '../_components/settings-ui';
import { takeNotice, type Notice, type NoticeTone } from '../_components/sticky-notice';
import { TimezonePicker } from '../_components/timezone-picker';
import { US_STATES } from '../_data/us-states';
import { detectTimezone } from '../_data/timezones';

/* ──────────────────────────── draft helpers ────────────────────────────── */

const PROFILE_FIELDS = [
  'name',
  'phone',
  'timezone',
  'addressStreet',
  'addressCity',
  'addressState',
  'addressZip',
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
  };
}

function sameProfile(a: ProfileDraft, b: ProfileDraft): boolean {
  return PROFILE_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * A form draft that tracks the server row WITHOUT ever discarding unsaved
 * typing: the server's version is adopted only while the draft still equals
 * the last one that came down. `source` must be referentially stable.
 */
function useTrackedDraft<T>(
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
      return isEqual(current, previousBaseline) ? source : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const dirty = draft !== null && baseline !== null && !isEqual(draft, baseline);
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

/** Whole years between a 'YYYY-MM-DD' birthday and today. */
export function ageInYears(dateOfBirth: string, now: Date): number | null {
  const day = dateOfBirth.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const born = parseDateOnly(day);
  let years = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) years -= 1;
  return years >= 0 && years < 130 ? years : null;
}

/* ─────────────────────────────── the page ──────────────────────────────── */

const FORM_ID = 'portal-settings-details';

export function DetailsSettings() {
  const { settings, isLoading, isError, error, refetch, identity, identityLoading, saveProfile, isSavingProfile } =
    useCustomerSettings();

  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const parked = takeNotice();
    if (parked) setNotice(parked);
  }, []);

  const serverProfile = useMemo(() => (settings ? toProfileDraft(settings) : null), [settings]);
  const [profile, setProfile, dirty] = useTrackedDraft(serverProfile, sameProfile);
  const [saved, flashSaved] = useSavedFlash();
  const [saveError, setSaveError] = useState<string | null>(null);

  const setField = useCallback(
    <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) => {
      setProfile((current) => (current === null ? current : { ...current, [field]: value }));
    },
    [setProfile],
  );

  const onSave = useCallback(async () => {
    if (!profile) return;
    setSaveError(null);
    try {
      await saveProfile(profile);
      flashSaved();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'We could not save your changes.');
    }
  }, [profile, saveProfile, flashSaved]);

  const onReset = useCallback(() => {
    setSaveError(null);
    if (serverProfile) setProfile(serverProfile);
  }, [serverProfile, setProfile]);

  // A clock after mount, so the age does not disagree between server and client.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const today = todayDateString();
  const documentExpiry = identity?.documentExpiry ?? null;
  const documentExpired = documentExpiry !== null && documentExpiry.slice(0, 10) < today;
  const dateOfBirth = settings?.dateOfBirth ?? identity?.dateOfBirth ?? null;
  const age = dateOfBirth && now ? ageInYears(dateOfBirth, now) : null;
  const suggestedTimezone = useMemo(() => detectTimezone(), []);
  const nameMissing = profile !== null && profile.name.trim() === '';

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHeader title="Details" description="How we address you, how we reach you, and where you live." />

      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}
      {isError ? <LoadError title="We could not load your details" error={error} onRetry={refetch} /> : null}
      {saveError ? <Banner tone="danger">{saveError}</Banner> : null}
      {isLoading ? <SettingsSkeleton /> : null}

      {!isLoading && !isError && settings === null ? (
        <LoadError
          title="We could not find your account on this site"
          error={new Error('Your sign-in worked, but there is no customer record for this company. Please contact them so they can link it.')}
          onRetry={refetch}
        />
      ) : null}

      {!isLoading && settings !== null && profile !== null ? (
        <>
          <form
            id={FORM_ID}
            onSubmit={(event) => {
              event.preventDefault();
              if (nameMissing) return;
              void onSave();
            }}
          >
            <SettingsRow label="Full name" description="As it appears on your driving licence or ID." htmlFor="settings-name">
              <Input
                id="settings-name"
                value={profile.name}
                onChange={(event) => setField('name', event.target.value)}
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

            <SettingsRow label="Phone" description="Used for your bookings, and to reach you on the day." htmlFor="settings-phone">
              <Input
                id="settings-phone"
                type="tel"
                inputMode="tel"
                value={profile.phone}
                onChange={(event) => setField('phone', event.target.value)}
                autoComplete="tel"
                placeholder="+1 555 000 0000"
                className={cn(PV_INPUT, 'max-w-md')}
              />
            </SettingsRow>

            <SettingsRow
              label="Date of birth"
              description={
                dateOfBirth ? (
                  <span className="inline-flex items-center gap-1.5 text-pv-success">
                    From your verified ID
                  </span>
                ) : (
                  'Set when you verify your ID.'
                )
              }
            >
              <ReadOnlyValue
                value={
                  identityLoading && dateOfBirth === null ? (
                    <span className="text-pv-muted-fg">Checking…</span>
                  ) : dateOfBirth ? (
                    <>
                      {formatDate(dateOfBirth.slice(0, 10)) ?? dateOfBirth}
                      {age !== null ? <span className="text-pv-muted-fg"> · {age} years old</span> : null}
                    </>
                  ) : (
                    <span className="text-pv-muted-fg">Not on file</span>
                  )
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Document expiry"
              description={
                documentExpired
                  ? 'Renew your document and verify it again before your next rental.'
                  : documentExpiry
                    ? 'From your verified ID.'
                    : 'Set when you verify your ID.'
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
                    <StatusPill tone={documentExpired ? 'negative' : 'positive'}>{documentExpired ? 'Expired' : 'Valid'}</StatusPill>
                  ) : undefined
                }
              />
            </SettingsRow>

            <SettingsRow label="Time zone" description="Pickup and return times are shown in this zone." htmlFor="settings-timezone">
              <TimezonePicker id="settings-timezone" value={profile.timezone} onChange={(tz) => setField('timezone', tz)} />
              {profile.timezone === '' && suggestedTimezone !== null ? (
                <RowHint>
                  Your device says{' '}
                  <button
                    type="button"
                    onClick={() => setField('timezone', suggestedTimezone)}
                    className="rounded-sm font-medium text-pv-link underline-offset-2 hover:underline"
                  >
                    {suggestedTimezone.split('/').pop()?.replace(/_/g, ' ')}
                  </button>
                  .
                </RowHint>
              ) : null}
            </SettingsRow>

            <SettingsRow label="Street address" htmlFor="settings-address-street">
              <Input
                id="settings-address-street"
                value={profile.addressStreet}
                onChange={(event) => setField('addressStreet', event.target.value)}
                autoComplete="address-line1"
                placeholder="123 Main Street"
                className={cn(PV_INPUT, 'max-w-xl')}
              />
            </SettingsRow>

            <SettingsRow label="City, state and ZIP code" description="Used to fill in your rental and insurance paperwork.">
              <div className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                <Input
                  id="settings-address-city"
                  aria-label="City"
                  value={profile.addressCity}
                  onChange={(event) => setField('addressCity', event.target.value)}
                  autoComplete="address-level2"
                  placeholder="City"
                  className={cn(PV_INPUT, 'col-span-2 sm:col-span-1')}
                />
                <Select value={profile.addressState === '' ? undefined : profile.addressState} onValueChange={(value) => setField('addressState', value)}>
                  <SelectTrigger id="settings-address-state" aria-label="State" className={PV_SELECT_TRIGGER}>
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
                <Input
                  id="settings-address-zip"
                  aria-label="ZIP code"
                  value={profile.addressZip}
                  onChange={(event) => setField('addressZip', event.target.value.slice(0, 10))}
                  autoComplete="postal-code"
                  placeholder="ZIP"
                  className={PV_INPUT}
                />
              </div>
            </SettingsRow>
          </form>

          <SettingsSaveBar formId={FORM_ID} dirty={dirty} saving={isSavingProfile} saved={saved} onReset={onReset} />
        </>
      ) : null}
    </div>
  );
}

/** A page-level notice in the v2 tints. */
function Banner({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
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
      <p className="flex-1">{children}</p>
    </div>
  );
}
