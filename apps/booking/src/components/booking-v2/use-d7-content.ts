"use client";

/**
 * Real content for the booking-v2 landing.
 *
 * Everything the design renders comes from the same sources the legacy home
 * page uses — the tenant's CMS rows, their tenant record, their vehicles and
 * their testimonials — so a tenant serving booking-v2 sees THEIR copy, fleet
 * and contact details, not placeholders.
 *
 * Each section falls back to the CMS defaults (`defaultHomeContent`) when a
 * tenant has not authored that block, which is exactly what the legacy page
 * does. Sections with no data at all report `false` so the landing can drop
 * them rather than render an empty shell.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  customerPhotoUrl, VEHICLE_PHOTO_COLUMNS, vehiclePublicColumns, type VehiclePhoto,
} from "@/lib/vehicle-identity";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";
import {
  defaultHomeContent, mergeWithDefaults, usePageContent,
  type BookingHeaderContent, type CarouselMediaItem, type ContactCardContent,
  type HomeCTAContent, type HomeHeroContent, type PromoBadgeContent,
  type ServiceHighlightsContent, type TestimonialsHeaderContent,
} from "@/hooks/usePageContent";

type RawVehicle = {
  id: string;
  make: string | null;
  model: string | null;
  year: number | string | null;
  category: string | null;
  fuel_type: string | null;
  daily_rent: number | null;
  photo_url: string | null;
  is_paused: boolean | null;
  is_disposed: boolean | null;
  available_daily: boolean | null;
  vehicle_photos?: (VehiclePhoto & { display_order?: number | null })[] | null;
};

export type D7Vehicle = {
  id: string;
  name: string;          // "2022 Toyota Camry"
  category: string | null;
  fuel: string | null;
  rate: number | null;   // daily_rent
  img: string | null;
};

export type D7Review = {
  id: string;
  quote: string;
  name: string;
  org: string | null;
  stars: number;
};

/** Split the CMS trust line ("A • B • C") into its parts. */
function splitTrustLine(line: string | undefined): string[] {
  if (!line) return [];
  return line.split(/[•|]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Everything the site chrome (nav + footer) needs.
 *
 * Kept separate from `useD7Content` because the nav and footer render on every
 * public page — dragging the vehicle and testimonial queries onto /faq or
 * /terms would be pure waste.
 */
export function useD7Chrome() {
  const { tenant } = useTenant();
  const { branding } = useBrandingSettings();
  const { data: rawContent } = usePageContent("home");
  const content = mergeWithDefaults(rawContent, defaultHomeContent);

  const hero: Partial<HomeHeroContent> = content.home_hero ?? {};
  const card: Partial<ContactCardContent> = content.contact_card ?? {};

  const appName = branding.app_name || tenant?.app_name || tenant?.company_name || "Drive 247";
  const phone = hero.phone_number || tenant?.phone || null;
  const email = card.email || tenant?.contact_email || null;

  /* Only the channels this tenant actually filled in. */
  const contact = [
    phone && {
      icon: "phone", label: "Call us", value: phone,
      href: `tel:${phone.replace(/[^+\d]/g, "")}`,
    },
    email && { icon: "mail", label: "Email us", value: email, href: `mailto:${email}` },
    tenant?.address && { icon: "pin", label: "Visit us", value: tenant.address },
  ].filter(Boolean) as { icon: string; label: string; value: string; href?: string }[];

  const socials = [
    tenant?.facebook_url && { name: "facebook", href: tenant.facebook_url },
    tenant?.instagram_url && { name: "instagram", href: tenant.instagram_url },
    tenant?.twitter_url && { name: "x", href: tenant.twitter_url },
    tenant?.linkedin_url && { name: "linkedin", href: tenant.linkedin_url },
  ].filter(Boolean) as { name: string; href: string }[];

  return {
    tenant,
    appName,
    logoUrl: tenant?.logo_url ?? null,
    /* The footer sits on a near-black ground; a tenant's light logo disappears
       into it, which is what dark_logo_url exists for. */
    darkLogoUrl: tenant?.dark_logo_url ?? tenant?.logo_url ?? null,
    phone,
    bookCta: hero.book_cta_text || "Book Now",
    blurb: card.description || hero.subheading,
    contact,
    socials,
  };
}

export function useD7Content() {
  const chrome = useD7Chrome();
  const { tenant } = useTenant();
  const { data: rawContent } = usePageContent("home");

  const content = mergeWithDefaults(rawContent, defaultHomeContent);

  const [vehicles, setVehicles] = useState<D7Vehicle[]>([]);
  const [reviews, setReviews] = useState<D7Review[]>([]);

  /* ------------------------------------------------------------- fleet */
  const tenantId = tenant?.id;
  const hidesPlates = tenant?.hide_vehicle_registration ?? null;

  useEffect(() => {
    if (!tenantId || !tenant) return;
    let cancelled = false;

    (async () => {
      /* Mirrors the public Fleet page exactly:
         - vehiclePublicColumns() withholds `reg` entirely for tenants that hide
           plates, so it is never sent to the browser rather than merely unshown
         - photos come from the vehicle_photos relation, and customerPhotoUrl()
           picks the plate-redacted variant where the operator produced one
         - paused and disposed vehicles are off the road and must not appear on
           ANY public surface, so they are filtered out here too */
      const { data } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: unknown) => { order: (c: string) => Promise<{ data: RawVehicle[] | null }> };
          };
        };
      })
        .from("vehicles")
        .select(vehiclePublicColumns(tenant, "daily_rent", "available_daily", VEHICLE_PHOTO_COLUMNS))
        .eq("tenant_id", tenantId)
        .order("daily_rent");

      if (cancelled || !data) return;

      const visible = data
        .filter(v => !v.is_paused && !v.is_disposed)
        /* daily rates are what this rail advertises */
        .filter(v => v.available_daily !== false)
        .slice(0, 12);

      setVehicles(visible.map(v => {
        const photo = [...(v.vehicle_photos ?? [])]
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))[0];
        return {
          id: v.id,
          name: [v.year, v.make, v.model].filter(Boolean).join(" ").trim() || "Vehicle",
          category: v.category,
          fuel: v.fuel_type,
          rate: v.daily_rent,
          img: customerPhotoUrl(photo, tenant) ?? v.photo_url ?? null,
        };
      }));
    })();

    return () => { cancelled = true; };
    /* `tenant` itself is intentionally not a dependency: TenantContext swaps
       that object on every realtime update, which would re-run this query on
       unrelated changes. Only the id and the plate-visibility flag alter the
       result. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, hidesPlates]);

  /* -------------------------------------------------------- testimonials */
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("testimonials")
        .select("id, author, company_name, review, stars")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (cancelled || !data) return;
      setReviews(data.map(t => ({
        id: t.id,
        quote: t.review,
        name: t.author,
        org: t.company_name,
        /* stars is nullable in the schema; the design draws a 5-star row. */
        stars: Math.min(5, Math.max(1, t.stars ?? 5)),
      })));
    })();

    return () => { cancelled = true; };
  }, [tenantId]);

  /* --------------------------------------------------------------- hero */
  const hero: Partial<HomeHeroContent> = content.home_hero ?? {};
  const carousel: CarouselMediaItem[] =
    hero.carousel_media?.length
      ? hero.carousel_media
      : (hero.carousel_images ?? []).map((url: string) => ({ url, type: "image" as const }));

  return {
    ...chrome,

    hero: {
      headline: hero.headline,
      subheading: hero.subheading,
      bookCta: chrome.bookCta,
      phoneCta: hero.phone_cta_text,
      phone: chrome.phone,
      trustPoints: splitTrustLine(hero.trust_line),
      media: carousel,
      /* The hero art falls back to the first carousel image, then the
         background image — the design needs exactly one still. */
      still: carousel.find(m => m.type === "image")?.url
        || hero.background_image
        || null,
    },

    promo:              (content.promo_badge ?? {}) as Partial<PromoBadgeContent>,
    services:           (content.service_highlights ?? {}) as Partial<ServiceHighlightsContent>,
    bookingHeader:      (content.booking_header ?? {}) as Partial<BookingHeaderContent>,
    testimonialsHeader: (content.testimonials_header ?? {}) as Partial<TestimonialsHeaderContent>,
    cta:                (content.home_cta ?? {}) as Partial<HomeCTAContent>,
    contact:            (content.contact_card ?? {}) as Partial<ContactCardContent>,

    vehicles,
    reviews,

    /* Sections with nothing to show are dropped rather than rendered empty. */
    hasVehicles: vehicles.length > 0,
    hasReviews: reviews.length > 0,
  };
}
