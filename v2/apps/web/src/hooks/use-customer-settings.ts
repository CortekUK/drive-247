'use client';

/**
 * The read/write model behind /portal/settings.
 *
 * ── SCOPING IS THE WHOLE POINT ──────────────────────────────────────────────
 * Every statement in this file — the two reads AND the update — carries
 * `.eq('id' | 'customer_id', customerId).eq('tenant_id', tenantId)`. On staging
 * `customers` is reachable with the public anon key, so those filters are not
 * an optimisation: they are what stops one customer reading or WRITING another
 * one's row. The ids come from `useCustomer()`, which derives them from the
 * Supabase session — never from a prop, a URL or a query string, because an id
 * that can be passed in is an id that can be swapped.
 *
 * v1 (`apps/booking/.../portal/settings/page.tsx`) updates on `.eq('id', …)`
 * alone. That is the one behavioural difference here, and it is deliberate.
 *
 * ── AN UPDATE THAT MATCHES NOTHING IS NOT A SUCCESS ─────────────────────────
 * PostgREST returns 204 with no error when an UPDATE matches zero rows, so v1's
 * `if (error) throw` reports "Profile updated successfully" for a write that
 * never happened — exactly what a wrong tenant id, a revoked grant or a
 * mistyped customer id looks like. Every mutation below therefore asks for the
 * row back (`.select(…).maybeSingle()`) and treats `null` as a failure. The
 * returned row is also what the cache is updated from, so the form always
 * reflects what the DATABASE now holds rather than what we hoped we sent.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 * Email and password live on `auth.users`, not on `customers`, and are changed
 * through `supabase.auth`. They are in the page rather than in this hook because
 * they invalidate the SESSION, not this query — see the note on the sticky
 * notice in `page.tsx`.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTenant } from '@/contexts/TenantContext';
import { useCustomer } from '@/hooks/use-customer';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type CustomerRow = Database['public']['Tables']['customers']['Row'];
type CustomerUpdate = Database['public']['Tables']['customers']['Update'];
type VerificationRow = Database['public']['Tables']['identity_verifications']['Row'];

/**
 * The customer columns this page reads and writes.
 *
 * A `Pick` over the generated Row rather than a hand-written interface, so a
 * column that does not exist fails to COMPILE instead of 400-ing at runtime.
 * That matters more than usual here: PostgREST rejects the entire row for one
 * unknown name, so a single typo does not blank one field — it empties the
 * whole settings page.
 */
export type CustomerSettingsRow = Pick<
  CustomerRow,
  | 'id'
  | 'tenant_id'
  | 'name'
  | 'email'
  | 'phone'
  | 'timezone'
  | 'address_street'
  | 'address_city'
  | 'address_state'
  | 'address_zip'
  | 'license_number'
  | 'license_state'
  | 'sms_consent'
  | 'sms_consent_at'
  | 'whatsapp_opt_in'
  | 'profile_photo_url'
  | 'date_of_birth'
>;

const SETTINGS_COLUMNS = [
  'id',
  'tenant_id',
  'name',
  'email',
  'phone',
  'timezone',
  'address_street',
  'address_city',
  'address_state',
  'address_zip',
  'license_number',
  'license_state',
  'sms_consent',
  'sms_consent_at',
  'whatsapp_opt_in',
  'profile_photo_url',
  'date_of_birth',
] satisfies readonly (keyof CustomerSettingsRow)[];

/**
 * Compile-time proof that the select list and the type cannot drift.
 * `satisfies` above rejects a column that is not on the type; this rejects one
 * that is on the type but missing from the list, which would otherwise leave a
 * field typed as present and `undefined` forever.
 */
type AssertTrue<T extends true> = T;
type _EverySettingsColumnIsSelected = AssertTrue<
  [
    Exclude<keyof CustomerSettingsRow, (typeof SETTINGS_COLUMNS)[number]>,
  ] extends [never]
    ? true
    : false
>;

const SETTINGS_SELECT = SETTINGS_COLUMNS.join(', ');

/* ──────────────────────────── view model ───────────────────────────────── */

/** The editable half of the profile, as the form holds it: strings, never null. */
export interface ProfileDraft {
  name: string;
  phone: string;
  timezone: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  licenseNumber: string;
  licenseState: string;
}

export interface NotificationDraft {
  smsConsent: boolean;
  whatsappOptIn: boolean;
}

export interface CustomerSettings extends ProfileDraft, NotificationDraft {
  /** `customers.email`. May lag `auth.users.email` — see `page.tsx`. */
  email: string | null;
  profilePhotoUrl: string | null;
  /** 'YYYY-MM-DD' or null. Read-only: it is set by identity verification. */
  dateOfBirth: string | null;
  /** When SMS consent was captured. Null when it never was. */
  smsConsentAt: string | null;
}

/**
 * `null` and `''` are the same thing to a text input, and the DB uses both.
 * Collapsing them here is what makes `isDirty` honest: without it a field that
 * loaded as null and was never touched would compare unequal to its own `''`.
 */
function text(value: string | null | undefined): string {
  return value ?? '';
}

function toSettings(row: CustomerSettingsRow): CustomerSettings {
  return {
    name: text(row.name),
    phone: text(row.phone),
    timezone: text(row.timezone),
    addressStreet: text(row.address_street),
    addressCity: text(row.address_city),
    addressState: text(row.address_state),
    addressZip: text(row.address_zip),
    licenseNumber: text(row.license_number),
    licenseState: text(row.license_state),
    // `sms_consent` is NOT NULL in the schema, `whatsapp_opt_in` is nullable.
    // Both are coerced so the switches are always controlled — a switch that
    // flips from undefined to false on load logs a React warning and, worse,
    // reads to the customer as a preference changing by itself.
    smsConsent: row.sms_consent === true,
    whatsappOptIn: row.whatsapp_opt_in === true,
    email: row.email,
    profilePhotoUrl: row.profile_photo_url,
    dateOfBirth: row.date_of_birth,
    smsConsentAt: row.sms_consent_at,
  };
}

/** The two facts the ID check contributes, both read-only on this page. */
export interface IdentityFacts {
  /** 'YYYY-MM-DD' or null. */
  dateOfBirth: string | null;
  /** 'YYYY-MM-DD' or null — when the licence/passport expires. */
  documentExpiry: string | null;
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

export interface UseCustomerSettingsResult {
  settings: CustomerSettings | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;

  /**
   * Date of birth and document expiry, from the most recent identity check.
   * Null while loading, and null when the customer has never verified — the
   * page must not render "—" as if the value were missing rather than absent.
   */
  identity: IdentityFacts | null;
  identityLoading: boolean;

  saveProfile: (draft: ProfileDraft) => Promise<void>;
  isSavingProfile: boolean;

  saveNotifications: (draft: NotificationDraft) => Promise<void>;
  isSavingNotifications: boolean;
}

export function useCustomerSettings(): UseCustomerSettingsResult {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { customerId, refresh } = useCustomer();

  const tenantId = tenant?.id ?? null;

  // Both ids are in the key. The customer id in particular: without it, one
  // customer signing out and another signing in on the same browser would be
  // served the first one's profile until the stale time elapsed.
  const settingsKey = useMemo(
    () => ['customer-settings', tenantId, customerId] as const,
    [tenantId, customerId],
  );

  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: async (): Promise<CustomerSettings | null> => {
      if (!customerId || !tenantId) return null;

      const { data, error } = await supabase
        .from('customers')
        .select(SETTINGS_SELECT)
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        // `maybeSingle`, not `single`: `single` treats "no row" as an ERROR, and
        // a legacy customer row with a null `tenant_id` would then render the
        // page as broken rather than as empty.
        .maybeSingle()
        .overrideTypes<CustomerSettingsRow, { merge: false }>();

      if (error) {
        console.error('[useCustomerSettings] Failed to load settings', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your details');
      }

      return data ? toSettings(data) : null;
    },
    enabled: !!customerId && !!tenantId,
  });

  /**
   * Date of birth and ID expiry come from the identity check, never from the
   * customer. They are shown read-only for exactly that reason: they are what
   * the document said, and letting them be typed over would put the portal and
   * the scanned licence out of step with no way to tell which is right.
   */
  const identityQuery = useQuery({
    queryKey: ['customer-identity-facts', tenantId, customerId] as const,
    queryFn: async (): Promise<IdentityFacts | null> => {
      if (!customerId || !tenantId) return null;

      const { data, error } = await supabase
        .from('identity_verifications')
        .select('date_of_birth, document_expiry_date')
        .eq('customer_id', customerId)
        // v1 omits this filter. `identity_verifications.tenant_id` exists and a
        // customer id is reused when a row is copied between tenants, so this
        // is the same boundary every other query here holds.
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
        .overrideTypes<
          Pick<VerificationRow, 'date_of_birth' | 'document_expiry_date'>,
          { merge: false }
        >();

      if (error) {
        console.error('[useCustomerSettings] Failed to load identity facts', {
          message: error.message,
          code: error.code,
        });
        // Deliberately NOT rethrown. These two fields are supporting detail;
        // failing them must not take the whole settings page down with them.
        return null;
      }

      if (!data) return null;
      return {
        dateOfBirth: data.date_of_birth,
        documentExpiry: data.document_expiry_date,
      };
    },
    enabled: !!customerId && !!tenantId,
  });

  /**
   * The one write path. Both mutations funnel through it so the scoping, the
   * zero-rows check and the cache update exist in exactly one place.
   */
  const applyUpdate = useCallback(
    async (patch: CustomerUpdate): Promise<CustomerSettings> => {
      if (!customerId || !tenantId) {
        throw new Error(
          'We could not confirm who you are signed in as. Please reload the page.',
        );
      }

      const { data, error } = await supabase
        .from('customers')
        .update(patch)
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .select(SETTINGS_SELECT)
        .maybeSingle()
        .overrideTypes<CustomerSettingsRow, { merge: false }>();

      if (error) {
        console.error('[useCustomerSettings] Update failed', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'We could not save your changes');
      }

      if (!data) {
        // 204 with no row: the filter matched nothing. Silent data loss unless
        // it is turned into an error here.
        throw new Error(
          'Your changes were not saved — we could not find your account on this site. Please reload and try again.',
        );
      }

      return toSettings(data);
    },
    [customerId, tenantId],
  );

  const onSaved = useCallback(
    async (next: CustomerSettings) => {
      queryClient.setQueryData(settingsKey, next);
      // The shell's avatar and greeting read the customer row from the auth
      // store, not from this query, so a rename would otherwise show in the
      // form and nowhere else until a reload. `refresh()` re-reads the
      // membership WITHOUT clearing `membershipResolved`, so it does not
      // unmount the portal layout mid-save.
      await refresh();
    },
    [queryClient, settingsKey, refresh],
  );

  const profileMutation = useMutation({
    mutationFn: async (draft: ProfileDraft): Promise<CustomerSettings> => {
      const name = draft.name.trim();
      if (name === '') {
        throw new Error('Please enter your name.');
      }

      // Empty text is written as NULL, never as ''. The insurance and Bonzah
      // payloads test these columns for presence, and '' is present.
      return applyUpdate({
        name,
        phone: draft.phone.trim() || null,
        timezone: draft.timezone || null,
        address_street: draft.addressStreet.trim() || null,
        address_city: draft.addressCity.trim() || null,
        address_state: draft.addressState || null,
        address_zip: draft.addressZip.trim() || null,
        license_number: draft.licenseNumber.trim() || null,
        license_state: draft.licenseState || null,
      });
    },
    onSuccess: onSaved,
  });

  const notificationsMutation = useMutation({
    mutationFn: async (draft: NotificationDraft): Promise<CustomerSettings> => {
      const current = settingsQuery.data;

      /*
        `sms_consent_at` is an A2P 10DLC audit field: it records WHEN consent
        was given, and the carrier registration relies on it. So it is stamped
        only on the false → true transition, and left alone otherwise —
        re-stamping it on an unrelated save would rewrite the audit trail, and
        clearing it on opt-out would destroy the record that consent ever
        existed. The stamp is generated here rather than by a DB default because
        `customers` has no trigger for it.
      */
      const turningSmsOn = draft.smsConsent && current?.smsConsent !== true;

      return applyUpdate({
        sms_consent: draft.smsConsent,
        ...(turningSmsOn ? { sms_consent_at: new Date().toISOString() } : {}),
        whatsapp_opt_in: draft.whatsappOptIn,
      });
    },
    onSuccess: onSaved,
  });

  const saveProfile = useCallback(
    async (draft: ProfileDraft) => {
      await profileMutation.mutateAsync(draft);
    },
    [profileMutation],
  );

  const saveNotifications = useCallback(
    async (draft: NotificationDraft) => {
      await notificationsMutation.mutateAsync(draft);
    },
    [notificationsMutation],
  );

  const refetch = useCallback(() => {
    void settingsQuery.refetch();
    void identityQuery.refetch();
  }, [settingsQuery, identityQuery]);

  return {
    settings: settingsQuery.data ?? null,
    // `isPending` alone would read as "loading" forever while the query is
    // disabled (no ids yet), so the enabled-ness is folded in.
    isLoading:
      (!!customerId && !!tenantId && settingsQuery.isPending) ||
      !customerId ||
      !tenantId,
    isError: settingsQuery.isError,
    error: settingsQuery.error instanceof Error ? settingsQuery.error : null,
    refetch,

    identity: identityQuery.data ?? null,
    identityLoading: !!customerId && !!tenantId && identityQuery.isPending,

    saveProfile,
    isSavingProfile: profileMutation.isPending,

    saveNotifications,
    isSavingNotifications: notificationsMutation.isPending,
  };
}
