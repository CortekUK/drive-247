"use client";

import { useMemo } from "react";

import { useTenant } from "@/contexts/TenantContext";

export interface TenantBranding {
  /** Name to render in the header, tab title and transactional copy. */
  appName: string | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  faviconUrl: string | null;
  heroBackgroundUrl: string | null;
  /** ISO 4217 code, e.g. "USD". Null until the tenant loads. */
  currencyCode: string | null;
  /** "miles" or "km" — drives every mileage figure in the booking sidebar. */
  distanceUnit: "miles" | "km" | null;
  /** Label to render next to a mileage number, e.g. "mi". */
  distanceLabel: string | null;
  /** Formats a number in the tenant's currency; identity-safe before load. */
  formatCurrency: (amount: number) => string;
}

/**
 * Derived, render-ready view of the tenant's brand and unit settings.
 *
 * Every value is nullable on purpose. Inventing a fallback colour or currency
 * here would paint one tenant's site in another's identity for the moment before
 * the row arrives; components should fall back to the design tokens in
 * globals.css instead.
 */
export function useTenantBranding(): TenantBranding {
  const { tenant } = useTenant();

  return useMemo<TenantBranding>(() => {
    const currencyCode = tenant?.currency_code ?? null;

    const rawUnit = tenant?.distance_unit;
    const distanceUnit =
      rawUnit === "km" || rawUnit === "miles" ? rawUnit : null;

    const formatCurrency = (amount: number): string => {
      if (!currencyCode) return amount.toFixed(2);
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currencyCode,
        }).format(amount);
      } catch {
        // An unrecognised ISO code must not take a price out of the page.
        return `${currencyCode} ${amount.toFixed(2)}`;
      }
    };

    return {
      appName: tenant?.app_name ?? tenant?.company_name ?? null,
      logoUrl: tenant?.logo_url ?? null,
      darkLogoUrl: tenant?.dark_logo_url ?? null,
      faviconUrl: tenant?.favicon_url ?? null,
      heroBackgroundUrl: tenant?.hero_background_url ?? null,
      currencyCode,
      distanceUnit,
      distanceLabel:
        distanceUnit === "miles" ? "mi" : distanceUnit === "km" ? "km" : null,
      formatCurrency,
    };
  }, [tenant]);
}
