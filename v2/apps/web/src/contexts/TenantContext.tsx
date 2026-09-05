"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  DEV_FALLBACK_TENANT_SLUG,
  extractTenantSlugFromHost,
  isPlatformHost,
} from "@/lib/constants";

type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];

/**
 * The booking-flow subset of a tenant.
 *
 * `Pick` over the generated Row is doing real work: a column name that does not
 * exist fails to compile here, instead of 400-ing the whole request at runtime.
 * PostgREST rejects the ENTIRE row when one column is unknown or ungranted to
 * `anon`, so a single typo does not degrade one field — it takes the tenant down
 * to null and every site silently falls back to default branding.
 */
export type Tenant = Pick<
  TenantRow,
  // Identity
  | "id"
  | "slug"
  | "company_name"
  | "status"
  | "payment_provider"
  | "contact_email"
  | "contact_phone"
  // Branding
  | "app_name"
  | "primary_color"
  | "secondary_color"
  | "accent_color"
  | "light_primary_color"
  | "light_secondary_color"
  | "light_accent_color"
  | "light_background_color"
  | "dark_primary_color"
  | "dark_secondary_color"
  | "dark_accent_color"
  | "dark_background_color"
  | "light_header_footer_color"
  | "dark_header_footer_color"
  | "logo_url"
  | "dark_logo_url"
  | "favicon_url"
  | "hero_background_url"
  | "customer_theme_mode"
  // SEO
  | "meta_title"
  | "meta_description"
  | "og_image_url"
  // Contact / site
  | "phone"
  | "address"
  | "business_hours"
  | "google_maps_url"
  | "facebook_url"
  | "instagram_url"
  | "twitter_url"
  | "linkedin_url"
  // Units & formatting — `distance_unit` drives every mileage figure in the
  // booking sidebar. v1 declares it on the interface and reads it in 8 places
  // but never SELECTs it, so there it is permanently `undefined`.
  | "currency_code"
  | "distance_unit"
  | "timezone"
  | "date_format"
  // Rental duration rules
  | "min_rental_days"
  | "min_rental_hours"
  | "max_rental_days"
  | "booking_lead_time_hours"
  | "minimum_rental_age"
  | "buffer_time_minutes"
  // Money
  | "tax_enabled"
  | "tax_percentage"
  | "service_fee_enabled"
  | "service_fee_type"
  | "service_fee_value"
  | "service_fee_amount"
  | "security_deposit_enabled"
  | "deposit_mode"
  | "deposit_charge_enabled"
  | "global_deposit_amount"
  | "installments_enabled"
  | "installment_config"
  | "payment_mode"
  | "hide_checkout_price_breakdown"
  | "show_effective_daily_rate"
  // Dynamic pricing
  | "weekend_surcharge_percent"
  | "weekend_days"
  | "monthly_tier_days"
  | "stack_surcharges"
  // Locations
  | "fixed_address_enabled"
  | "multiple_locations_enabled"
  | "area_around_enabled"
  | "pickup_location_mode"
  | "return_location_mode"
  | "fixed_pickup_address"
  | "fixed_return_address"
  | "pickup_area_radius_km"
  | "return_area_radius_km"
  | "area_center_lat"
  | "area_center_lon"
  | "area_delivery_fee"
  | "delivery_tiers_enabled"
  | "delivery_distance_tiers"
  | "delivery_max_distance_km"
  // Working hours
  | "working_hours_enabled"
  | "working_hours_open"
  | "working_hours_close"
  | "working_hours_always_open"
  // Integrations & booking options
  | "integration_twilio_sms"
  | "integration_bonzah"
  | "bonzah_mode"
  | "bonzah_sandbox_override"
  | "require_identity_verification"
  | "require_insurance_upload"
  | "gig_driver_enabled"
  | "enquiries_enabled"
  | "hide_vehicle_registration"
>;

/**
 * Explicit column list — never `select("*")`. `*` returns whatever the schema
 * happens to hold, which on this table includes columns `anon` has no grant for.
 *
 * Every name below was verified twice: against the generated `Database` types
 * (compile time, via the `Tenant` Pick above) and against the live database with
 * the anon key (runtime grants).
 */
const TENANT_SELECT = [
  "id",
  "slug",
  "company_name",
  "status",
  "payment_provider",
  "contact_email",
  "contact_phone",
  "app_name",
  "primary_color",
  "secondary_color",
  "accent_color",
  "light_primary_color",
  "light_secondary_color",
  "light_accent_color",
  "light_background_color",
  "dark_primary_color",
  "dark_secondary_color",
  "dark_accent_color",
  "dark_background_color",
  "light_header_footer_color",
  "dark_header_footer_color",
  "logo_url",
  "dark_logo_url",
  "favicon_url",
  "hero_background_url",
  "customer_theme_mode",
  "meta_title",
  "meta_description",
  "og_image_url",
  "phone",
  "address",
  "business_hours",
  "google_maps_url",
  "facebook_url",
  "instagram_url",
  "twitter_url",
  "linkedin_url",
  "currency_code",
  "distance_unit",
  "timezone",
  "date_format",
  "min_rental_days",
  "min_rental_hours",
  "max_rental_days",
  "booking_lead_time_hours",
  "minimum_rental_age",
  "buffer_time_minutes",
  "tax_enabled",
  "tax_percentage",
  "service_fee_enabled",
  "service_fee_type",
  "service_fee_value",
  "service_fee_amount",
  "security_deposit_enabled",
  "deposit_mode",
  "deposit_charge_enabled",
  "global_deposit_amount",
  "installments_enabled",
  "installment_config",
  "payment_mode",
  "hide_checkout_price_breakdown",
  "show_effective_daily_rate",
  "weekend_surcharge_percent",
  "weekend_days",
  "monthly_tier_days",
  "stack_surcharges",
  "fixed_address_enabled",
  "multiple_locations_enabled",
  "area_around_enabled",
  "pickup_location_mode",
  "return_location_mode",
  "fixed_pickup_address",
  "fixed_return_address",
  "pickup_area_radius_km",
  "return_area_radius_km",
  "area_center_lat",
  "area_center_lon",
  "area_delivery_fee",
  "delivery_tiers_enabled",
  "delivery_distance_tiers",
  "delivery_max_distance_km",
  "working_hours_enabled",
  "working_hours_open",
  "working_hours_close",
  "working_hours_always_open",
  "integration_twilio_sms",
  "integration_bonzah",
  "bonzah_mode",
  "bonzah_sandbox_override",
  "require_identity_verification",
  "require_insurance_upload",
  "gig_driver_enabled",
  "enquiries_enabled",
  "hide_vehicle_registration",
] satisfies readonly (keyof Tenant)[];

/**
 * Compile-time proof that the select list and the `Tenant` type cannot drift
 * apart. `satisfies` above rejects a column that is not on `Tenant`; this
 * rejects a column that is on `Tenant` but absent from the select — which would
 * otherwise leave the field typed as present and `undefined` at runtime, the
 * exact bug `distance_unit` has in v1.
 */
type AssertTrue<T extends true> = T;
type _EveryTenantColumnIsSelected = AssertTrue<
  [Exclude<keyof Tenant, (typeof TENANT_SELECT)[number]>] extends [never]
    ? true
    : false
>;

const TENANT_SELECT_CLAUSE = TENANT_SELECT.join(", ");

export interface TenantContextValue {
  tenant: Tenant | null;
  isLoading: boolean;
  error: string | null;
  /** Slug this provider resolved from the host / header, before any DB call. */
  tenantSlug: string | null;
  refetchTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

/**
 * Load the tenant row. Throws with the PostgREST message on failure so React
 * Query surfaces it — and logs the full error object, because the message names
 * the offending column, which is the single fastest way to diagnose a missing
 * `anon` grant.
 */
async function fetchTenant(slug: string): Promise<Tenant | null> {
  const { data, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT_CLAUSE)
    // Suspended tenants still resolve, so the site can say "unavailable" rather
    // than rendering as an untenanted shell.
    .in("status", ["active", "suspended"])
    .eq("slug", slug)
    .maybeSingle()
    .overrideTypes<Tenant, { merge: false }>();

  if (error) {
    console.error("[TenantContext] Failed to load tenant", {
      slug,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    throw new Error(
      error.message || `Failed to load tenant configuration for "${slug}"`,
    );
  }

  return data;
}

/** Client-side custom-domain resolution, mirroring the middleware's lookup. */
async function lookupCustomDomainSlug(host: string): Promise<string | null> {
  let hostname = host.split(":")[0].toLowerCase();
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (!hostname) return null;

  const { data, error } = await supabase
    .from("tenants")
    .select("slug")
    .eq("custom_booking_domain", hostname)
    .in("status", ["active", "suspended"])
    .maybeSingle();

  if (error) {
    console.error("[TenantContext] Custom domain lookup failed", {
      hostname,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return null;
  }

  return data?.slug ?? null;
}

export function TenantProvider({
  children,
  initialTenantSlug = null,
}: {
  children: ReactNode;
  /** Slug the middleware resolved, handed down from the server layout. */
  initialTenantSlug?: string | null;
}) {
  const [tenantSlug, setTenantSlug] = useState<string | null>(initialTenantSlug);
  // Distinct from "slug is null": until resolution finishes we must not claim
  // there is no tenant, or the UI flashes an error before the answer arrives.
  const [slugResolved, setSlugResolved] = useState(initialTenantSlug !== null);

  useEffect(() => {
    if (initialTenantSlug) {
      setTenantSlug(initialTenantSlug);
      setSlugResolved(true);
      return;
    }

    let cancelled = false;

    const resolve = async () => {
      const host = window.location.host;
      let slug = extractTenantSlugFromHost(host);

      if (!slug && !isPlatformHost(host)) {
        slug = await lookupCustomDomainSlug(host);
      }

      if (!slug) {
        slug = DEV_FALLBACK_TENANT_SLUG;
      }

      if (!cancelled) {
        setTenantSlug(slug);
        setSlugResolved(true);
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [initialTenantSlug]);

  const {
    data: tenant,
    error: queryError,
    isPending,
    isSuccess,
    refetch,
  } = useQuery({
    queryKey: ["tenant", tenantSlug],
    queryFn: async () => {
      if (!tenantSlug) return null;
      return fetchTenant(tenantSlug);
    },
    enabled: slugResolved && tenantSlug !== null,
    // Overrides the global `false`. These settings decide what the checkout
    // DISPLAYS, what it sends to the processor, and what lands on the invoice —
    // a tab left open across a settings change must not keep quoting a deposit
    // the operator has already switched off.
    refetchOnWindowFocus: true,
    // A missing tenant is an answer, not a transient failure; do not retry it.
    retry: 1,
  });

  const refetchTenant = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const value = useMemo<TenantContextValue>(() => {
    const notFound =
      slugResolved && tenantSlug !== null && isSuccess && !tenant
        ? `Tenant "${tenantSlug}" not found or inactive`
        : null;

    const noSlug =
      slugResolved && tenantSlug === null
        ? "No tenant could be resolved for this host"
        : null;

    return {
      tenant: tenant ?? null,
      isLoading: !slugResolved || (tenantSlug !== null && isPending),
      error: queryError?.message ?? notFound ?? noSlug,
      tenantSlug,
      refetchTenant,
    };
  }, [
    slugResolved,
    tenantSlug,
    tenant,
    isPending,
    isSuccess,
    queryError,
    refetchTenant,
  ]);

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

const EMPTY_TENANT_CONTEXT: TenantContextValue = {
  tenant: null,
  isLoading: false,
  error: null,
  tenantSlug: null,
  refetchTenant: async () => {},
};

/**
 * Safe outside a provider (server rendering, isolated tests) — returns empty
 * state rather than throwing, so a stray consumer cannot take a page down.
 */
export function useTenant(): TenantContextValue {
  return useContext(TenantContext) ?? EMPTY_TENANT_CONTEXT;
}
