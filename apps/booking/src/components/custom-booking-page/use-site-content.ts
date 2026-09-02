"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { usePageContent } from "@/hooks/usePageContent";
import { useDeliveryLocations } from "@/hooks/useDeliveryLocations";
import { useWorkingHours } from "@/hooks/useWorkingHours";
import { useHasFaqs } from "@/hooks/useHasFaqs";
import { useBlogPosts } from "@/hooks/useBlogPosts";
import { getTenantLegalEntityLine } from "@/config/tenant-config";
import { createCompanyNameReplacer } from "@/utils/tenantName";
import {
  VEHICLE_PHOTO_COLUMNS, customerPhotoUrl, vehicleDisplayName, vehiclePublicColumns,
} from "@/lib/vehicle-identity";
import { formatCurrency } from "@/lib/format-utils";
import { toThemeConfig, type CbpSeed } from "./seed";
import type { CbpThemeConfig } from "./theme";

/* ========================================================================== *
 * One hook, one source of truth, for every page of this site.
 *
 * Everything resolves from the tenant the middleware picked out of the
 * hostname, through the SAME hooks and tables the existing booking site and
 * the portal CMS already use — `tenants`, `cms_pages` / `cms_page_sections`,
 * `pickup_locations`, `vehicles`, `testimonials`, `promotions`, `blog_posts`.
 * No new content store, and nothing about any single operator written into the
 * code: point this at one tenant and it is their site, point it at another and
 * it is theirs.
 *
 * `usePageContent` already honours publish state — it selects only
 * `status = 'published'` pages outside local development — so unpublishing a
 * page in the portal hides its content here exactly as it does on the existing
 * site. Nothing here works around that.
 *
 * Sections take the "omit when empty" rule from here too: anything the
 * operator has not configured comes back empty, and the section that would
 * have shown it renders nothing rather than inventing a placeholder.
 * ========================================================================== */

export interface CbpVehicle {
  id: string;
  name: string;
  category: string | null;
  image: string | null;
  dailyRent: number | null;
  weeklyRent: number | null;
  monthlyRent: number | null;
  priceLabel: string | null;
  /** Factual chips only — year, fuel, category. Never invented. */
  specs: string[];
  description: string | null;
  deposit: number | null;
  status: string | null;
}

export interface CbpLocation {
  id: string; name: string; address: string;
  pickup: boolean; ret: boolean; fee: number;
}

export interface CbpReview {
  id: string; author: string; company: string | null; stars: number; review: string;
}

export interface CbpOffer {
  id: string; title: string; description: string | null;
  code: string | null; image: string | null;
  /** "Flat 15% OFF" / "SAR 500 OFF" — built from the stored type and value. */
  headline: string | null;
  endsOn: string | null;
}

export interface CbpArticle {
  id: string; title: string; slug: string; excerpt: string | null;
  image: string | null; category: string | null; publishedAt: string | null;
}

/** One frame of the hero slider, as uploaded and ordered in the portal. */
export interface CbpSlide {
  url: string;
  mobileUrl: string;
  alt: string;
  focal: string;
}

/**
 * One way a customer may collect or return a vehicle.
 *
 * The platform models this as three INDEPENDENT toggles per direction, not one
 * mode — an operator can offer their own forecourt, a set of delivery points,
 * customer-address delivery, or any combination. `pickup_location_mode` reads
 * like the answer and is not: every tenant measured carries "custom" there
 * while differing entirely in what they actually offer.
 */
export type CbpLocationOption =
  /** The operator's own address. No fee, nothing for the customer to enter. */
  | { kind: "fixed"; id: "fixed"; label: string; address: string; fee: number }
  /** One of their configured delivery points, with its fee. */
  | { kind: "location"; id: string; label: string; address: string; fee: number }
  /** Delivery to an address the customer types. */
  | { kind: "custom"; id: "custom"; label: string; address: ""; fee: number };

export interface CbpFaq { id: string; question: string; answer: string }

export interface CbpItem { icon: string; title: string; copy: string }
export interface CbpStat { icon: string; label: string; value: string }
export interface CbpLink { label: string; href: string }

export interface CbpContent {
  /* identity + brand */
  name: string;
  legalName: string | null;
  legalEntityLine: string | null;
  tagline: string | null;
  /** For a light ground — the header. */
  logoUrl: string | null;
  /** For a dark ground — the footer, and the header in dark mode. */
  darkLogoUrl: string | null;
  /** Convenience: the dark-ground logo, already falling back to the light one. */
  footerLogoUrl: string | null;
  /** False when the uploaded logo already contains the company name. */
  showLogoName: boolean;

  /* home */
  hero: {
    headline: string; highlight: string; subheading: string;
    /** Never empty — falls back to the approved visual. */
    slides: CbpSlide[];
    bookCta: string; fleetCta: string; trustLine: string;
    badges: string[];
  };
  features: CbpItem[];
  whyChoose: { title: string; copy: string; items: CbpItem[] };
  stats: CbpStat[];
  booking: { title: string; subtitle: string; trustPoints: string[] };
  cta: { title: string; description: string; primary: string; secondary: string };

  /* about */
  about: { title: string; paragraphs: string[]; heroTitle: string; heroSubtitle: string };

  /* fleet */
  fleetPage: { title: string; subtitle: string; inclusions: CbpItem[] };

  /* contact */
  contact: { title: string; subtitle: string };
  phone: string | null; phoneDisplay: string | null; phoneHref: string | null;
  email: string | null; address: string | null; mapsUrl: string | null; hours: string | null;
  whatsapp: string | null;
  weeklyHours: { day: string; value: string }[];

  /* promotions */
  offersPage: { title: string; subtitle: string };
  /** Blog listing hero — the same CMS section the existing /blog reads. */
  blogPage: { title: string; subtitle: string };

  /* legal */
  legal: { privacy: string | null; terms: string | null };

  /* terms of hire, read straight off the tenant row */
  rentalTerms: { label: string; value: string }[];

  /* collections — empty means "not configured" */
  vehicles: CbpVehicle[];
  categories: string[];
  locations: CbpLocation[];
  /** What this operator actually offers, in the order the customer sees it. */
  pickupOptions: CbpLocationOption[];
  returnOptions: CbpLocationOption[];
  reviews: CbpReview[];
  offers: CbpOffer[];
  articles: CbpArticle[];
  faqs: CbpFaq[];

  /** The operator's custom-site palette, or null for the approved default. */
  theme: CbpThemeConfig | null;

  /* chrome */
  nav: CbpLink[];
  social: CbpLink[];
  legalLinks: CbpLink[];
  copyright: string;
  blogEnabled: boolean;

  fleetLoading: boolean;
  faqsLoading: boolean;
  articlesLoading: boolean;
  offersLoading: boolean;
  loading: boolean;
}

/** Route prefix. Every internal link stays inside this site. */
export const CBP = "/custom-booking-page";

/**
 * The approved hero photograph — a premium vehicle against a city skyline,
 * shipped with the template so every tenant opens on the approved composition
 * rather than on whatever happens to sit first in their media library.
 * Operators can still replace it from the portal.
 */
export const APPROVED_HERO = "/carousel-images/car1.jpeg";

const DAY_LABELS: [string, string][] = [
  ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"], ["thursday", "Thu"],
  ["friday", "Fri"], ["saturday", "Sat"], ["sunday", "Sun"],
];

/** 24h "09:30" to "9:30 AM". Returns the input unchanged if not a time. */
function time12(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const period = h >= 12 ? "PM" : "AM";
  return (h % 12 === 0 ? 12 : h % 12) + ":" + m[2] + " " + period;
}

/**
 * The reference splits its headline across two colours. Operators author one
 * string, so the last two words take the gradient — enough to give the same
 * two-tone shape without guessing at their sentence structure. Three words or
 * fewer is left whole rather than reduced to a fragment.
 */
function splitHeadline(text: string): { headline: string; highlight: string } {
  const words = text.trim().split(/\s+/);
  if (words.length < 4) return { headline: text.trim(), highlight: "" };
  return { headline: words.slice(0, -2).join(" "), highlight: words.slice(-2).join(" ") };
}

/** Rich text from the portal editor, reduced to its paragraphs. */
function htmlParagraphs(html: string | null | undefined): string[] {
  if (!html) return [];
  return html
    .split(/<\/p>|<br\s*\/?>/i)
    .map(c => c.replace(/<[^>]*>/g, "").trim())
    .map(t => t
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').trim())
    .filter(Boolean);
}

export function useSiteContent(seed?: CbpSeed | null): CbpContent {
  const { tenant, loading: tenantLoading } = useTenant();
  const { branding } = useBrandingSettings();
  const { settings } = useSiteSettings();
  const { data: home, isLoading: cmsLoading } = usePageContent("home");
  const { data: aboutCms } = usePageContent("about");
  const { data: fleetCms } = usePageContent("fleet");
  const { data: contactCms } = usePageContent("contact");
  const { data: promoCms } = usePageContent("promotions");
  const { data: blogCms } = usePageContent("blog");
  const { data: privacyCms } = usePageContent("privacy");
  const { data: termsCms } = usePageContent("terms");
  // The logo section lives on the site-settings page, alongside contact and
  // social — the same record useSiteSettings reads for the rest of the mark.
  const { data: siteCms } = usePageContent("site-settings");
  const { locations, isLoading: locationsLoading } = useDeliveryLocations();
  const workingHours = useWorkingHours();
  const hasFaqs = useHasFaqs();

  // Until the tenant resolves in the browser the branding hook answers with
  // the PLATFORM's defaults, so prefer the server-rendered seed over them
  // rather than painting another company's name on the operator's own site.
  const name = tenant ? (branding.app_name || settings.company_name) : (seed?.name ?? "");
  const rename = useMemo(() => createCompanyNameReplacer(name), [name]);

  /* ------------------------------------------------------------- fleet --- */
  const { data: vehicles = [], isLoading: fleetLoading } = useQuery({
    queryKey: ["cbp-fleet", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CbpVehicle[]> => {
      // Explicit allowlist, never `*` — `vehicles` is readable by `anon`, so
      // every column named here is public. Mirrors /fleet exactly.
      const { data, error } = await supabaseUntyped
        .from("vehicles")
        .select(vehiclePublicColumns(tenant, VEHICLE_PHOTO_COLUMNS))
        .eq("tenant_id", tenant!.id)
        .order("daily_rent");
      if (error) throw error;
      const currency = tenant?.currency_code || "USD";

      return (data ?? [])
        // The same three exclusions /fleet applies: sold, off the road, and
        // vehicles with every hire duration switched off.
        .filter((v: any) => v.status !== "Disposed" && v.status !== "Sold")
        .filter((v: any) => !v.is_paused)
        .filter((v: any) => !(v.available_daily === false && v.available_weekly === false && v.available_monthly === false))
        .map((v: any) => {
          const photos = [...(v.vehicle_photos ?? [])].sort(
            (a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
          const daily = v.daily_rent == null ? null : Number(v.daily_rent);
          // Only columns that exist on `vehicles`. The reference's cards show
          // seats and transmission; this table stores neither, and inventing
          // them would be inventing the operator's fleet spec.
          const specs = [v.year, v.category, v.fuel_type]
            .map((s: unknown) => (s == null ? "" : String(s).trim())).filter(Boolean);
          return {
            id: v.id,
            name: vehicleDisplayName(v, tenant),
            category: v.category ?? null,
            image: customerPhotoUrl(photos[0], tenant) || v.photo_url || null,
            dailyRent: daily,
            weeklyRent: v.weekly_rent == null ? null : Number(v.weekly_rent),
            monthlyRent: v.monthly_rent == null ? null : Number(v.monthly_rent),
            priceLabel: daily == null ? null : formatCurrency(
              daily, currency,
              Number.isInteger(daily) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : undefined),
            specs,
            description: v.description ?? null,
            deposit: v.security_deposit == null ? null : Number(v.security_deposit),
            status: v.status ?? null,
          };
        });
    },
  });

  /* ----------------------------------------------------------- reviews --- */
  const { data: reviews = [] } = useQuery({
    queryKey: ["cbp-reviews", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CbpReview[]> => {
      const { data, error } = await supabaseUntyped
        .from("testimonials").select("id, author, company_name, stars, review")
        .eq("tenant_id", tenant!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((r: any) => r.review && r.author).map((r: any) => ({
        id: r.id, author: r.author, company: r.company_name?.trim() || null,
        stars: Math.max(1, Math.min(5, Number(r.stars) || 5)), review: r.review,
      }));
    },
  });

  /* ------------------------------------------------------------ offers --- */
  const { data: offers = [], isLoading: offersLoading } = useQuery({
    queryKey: ["cbp-offers", tenant?.id, tenant?.currency_code],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CbpOffer[]> => {
      const { data, error } = await supabaseUntyped
        .from("promotions").select("*")
        .eq("tenant_id", tenant!.id).eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const now = Date.now();
      const currency = tenant?.currency_code || "USD";
      return (data ?? [])
        // Same window the existing /promotions page applies.
        .filter((p: any) => !p.end_date || new Date(p.end_date).getTime() >= now)
        .filter((p: any) => !p.start_date || new Date(p.start_date).getTime() <= now)
        .map((p: any) => {
          const v = Number(p.discount_value);
          const headline = !p.discount_type || Number.isNaN(v) ? null
            : p.discount_type === "percentage" ? `${v}% OFF`
            : formatCurrency(v, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " OFF";
          return {
            id: p.id, title: p.title, description: p.description ?? null,
            code: p.promo_code ?? null, image: p.image_url ?? null,
            headline, endsOn: p.end_date ?? null,
          };
        });
    },
  });

  /* ---------------------------------------------------------- articles ---
     The homepage teaser only. The blog listing and article pages call
     `useBlogPosts` / `useBlogPost` directly, exactly as /blog does, so
     pagination, category filtering and the published-only rule are the
     existing ones rather than a second implementation. */
  const { data: blogPage, isLoading: articlesLoading } = useBlogPosts({ page: 1, pageSize: 3 });
  const articles: CbpArticle[] = useMemo(
    // Nothing to tease when the operator has the blog switched off — the
    // homepage panel would otherwise link into a route that redirects home.
    () => (tenant?.blog_enabled ? blogPage?.posts ?? [] : []).map(a => ({
      id: a.id, title: a.title, slug: a.slug, excerpt: a.excerpt ?? null,
      image: a.featured_image_url ?? null, category: a.category?.name ?? null,
      publishedAt: a.published_at ?? null,
    })),
    [blogPage, tenant?.blog_enabled],
  );

  /* ---------------------------------------------------------------- faqs -- */
  const { data: faqs = [], isLoading: faqsLoading } = useQuery({
    queryKey: ["cbp-faqs", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CbpFaq[]> => {
      const { data, error } = await supabaseUntyped
        .from("faqs")
        .select("id, question, answer, display_order")
        .eq("tenant_id", tenant!.id)
        // `is_active` is the operator's enable/disable switch in the portal.
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter((f: any) => f.question && f.answer)
        .map((f: any) => ({ id: f.id, question: f.question, answer: f.answer }));
    },
  });

  /* --------------------------------------------------- dynamic stat data --- */
  const { data: liveStats } = useQuery({
    queryKey: ["cbp-stats", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [rentals, vehiclesCount, ratings] = await Promise.all([
        supabase.from("rentals").select("*", { count: "exact", head: true }).eq("tenant_id", tenant!.id),
        supabaseUntyped.from("vehicles").select("*", { count: "exact", head: true })
          .eq("tenant_id", tenant!.id).eq("is_paused", false).eq("is_disposed", false),
        supabaseUntyped.from("testimonials").select("stars").eq("tenant_id", tenant!.id),
      ]);
      const stars = (ratings.data ?? []) as { stars: number }[];
      const avg = stars.length ? stars.reduce((s, r) => s + (r.stars || 5), 0) / stars.length : 0;
      return {
        totalRentals: rentals.count ?? 0,
        activeVehicles: vehiclesCount.count ?? 0,
        avgRating: avg,
      };
    },
  });

  return useMemo<CbpContent>(() => {
    // Before this flips true every hook above answers with platform defaults.
    // Only the seed is trustworthy until then.
    const resolved = !!tenant;
    const currency = tenant?.currency_code || "USD";
    const heroCms = home?.home_hero;

    /* The hero slider. Frames come from the operator's own hero gallery in
       the portal, in the order they arranged them, minus any they unticked.
       Videos are skipped — this is a crossfading still sequence.

       Falling back in order: the gallery, then a single deliberate hero
       choice (the hero background field, or the brand hero image), then the
       approved visual. An operator who has uploaded nothing still opens on
       the approved composition rather than on a blank frame. */
    const gallery: CbpSlide[] = (heroCms?.carousel_media ?? [])
      .filter(m => m.type === "image" && m.url && m.enabled !== false)
      .map(m => ({
        url: m.url,
        mobileUrl: m.mobile_url || m.url,
        alt: m.alt || "",
        focal: m.focal || "50% 50%",
      }));

    const single = heroCms?.background_image || branding.hero_background_url;
    const slides: CbpSlide[] = gallery.length
      ? gallery
      : [{ url: single || APPROVED_HERO, mobileUrl: single || APPROVED_HERO, alt: "", focal: "50% 50%" }];

    const rawHeadline = resolved
      ? rename(heroCms?.headline) || branding.meta_title || name
      : seed?.metaTitle || name;
    const { headline, highlight } = splitHeadline(rawHeadline);

    const phone = settings.phone || tenant?.phone || tenant?.contact_phone || null;
    const email = settings.email || tenant?.contact_email || null;
    const cityState = [settings.city, settings.state].filter(Boolean).join(", ");
    const street = [settings.address_line1, settings.address_line2, cityState].filter(Boolean).join(", ");
    const address = street || settings.office_address || tenant?.address || null;

    /* Rental terms — every entry is a stored tenant setting, so a term the
       operator has not set simply does not appear. Nothing is invented. */
    const rentalTerms: { label: string; value: string }[] = [];
    if (tenant?.minimum_rental_age) rentalTerms.push({ label: "Minimum age", value: tenant.minimum_rental_age + " years" });
    if (tenant?.booking_lead_time_hours != null) rentalTerms.push({ label: "Book ahead", value: tenant.booking_lead_time_hours + " hours" });
    if (tenant?.min_rental_days) rentalTerms.push({ label: "Minimum hire", value: tenant.min_rental_days + " days" });
    else if (tenant?.min_rental_hours) rentalTerms.push({ label: "Minimum hire", value: tenant.min_rental_hours + " hours" });
    if (tenant?.max_rental_days) rentalTerms.push({ label: "Maximum hire", value: tenant.max_rental_days + " days" });
    if (tenant?.security_deposit_enabled && tenant?.deposit_mode === "global" && tenant?.global_deposit_amount) {
      rentalTerms.push({ label: "Security deposit", value: formatCurrency(tenant.global_deposit_amount, currency) });
    }
    if (tenant?.require_identity_verification) rentalTerms.push({ label: "ID check", value: "Required" });

    const weeklyHours: { day: string; value: string }[] = [];
    if (workingHours.isAlwaysOpen) weeklyHours.push({ day: "Every day", value: "Open 24 hours" });
    else if (tenant?.working_hours_enabled) {
      for (const [key, label] of DAY_LABELS) {
        const d = workingHours.weeklySchedule?.[key as keyof typeof workingHours.weeklySchedule];
        if (!d) continue;
        weeklyHours.push({ day: label, value: d.enabled ? time12(d.open) + " – " + time12(d.close) : "Closed" });
      }
    }

    /* Statistics. The operator authors these in the About editor, where each
       item may be pinned to a live source; those resolve from real counts
       here, exactly as the existing /about page does. */
    const stats: CbpStat[] = (aboutCms?.stats?.items ?? [])
      .map(item => {
        const dyn = () => {
          if (!item.use_dynamic || !liveStats) return item.value;
          switch (item.dynamic_source) {
            // Years in business is derived from the founding year the operator
            // enters in the About editor. There is no trading-start date on
            // `tenants` to fall back to, so an operator who has not filled it
            // in gets no number — and the filter below drops the stat rather
            // than printing a "0+" this page made up.
            case "years_experience": {
              const founded = Number(aboutCms?.about_story?.founded_year);
              if (!founded || Number.isNaN(founded)) return "";
              return String(Math.max(0, new Date().getFullYear() - founded));
            }
            case "total_rentals":   return String(liveStats.totalRentals);
            case "active_vehicles": return String(liveStats.activeVehicles);
            case "avg_rating":      return liveStats.avgRating > 0 ? liveStats.avgRating.toFixed(1) : "";
            default: return item.value;
          }
        };
        const value = (dyn() || "").trim();
        return { icon: item.icon, label: rename(item.label), value: value ? value + (item.suffix ?? "") : "" };
      })
      // A stat with no number is not a stat — drop it rather than show "0+".
      .filter(s => s.value && s.value !== "0" && s.value !== "0+");

    /* What this operator actually offers for collection and return.
       Built from the same three per-direction flags the reservation engine
       reads, so the bar can never present a choice the engine would reject —
       nor hide one it would have allowed. The legacy combined flags are the
       fallback for tenants predating the split ones. */
    const buildLocationOptions = (dir: "pickup" | "return"): CbpLocationOption[] => {
      const isPickup = dir === "pickup";
      const fixedOn = (isPickup ? tenant?.pickup_fixed_enabled : tenant?.return_fixed_enabled)
        ?? tenant?.fixed_address_enabled ?? false;
      const multiOn = (isPickup ? tenant?.pickup_multiple_locations_enabled : tenant?.return_multiple_locations_enabled)
        ?? tenant?.multiple_locations_enabled ?? false;
      const areaOn = (isPickup ? tenant?.pickup_area_enabled : tenant?.return_area_enabled)
        ?? tenant?.area_around_enabled ?? false;
      const fixedAddress = isPickup ? tenant?.fixed_pickup_address : tenant?.fixed_return_address;

      const out: CbpLocationOption[] = [];

      if (fixedOn && fixedAddress) {
        out.push({
          kind: "fixed", id: "fixed",
          // Short enough not to ellipsise in its column, and it reads better
          // in the list beside an airport or hotel name.
          label: "Our location",
          address: fixedAddress, fee: 0,
        });
      }

      if (multiOn) {
        for (const l of locations) {
          if (!(isPickup ? l.is_pickup_enabled : l.is_return_enabled)) continue;
          out.push({
            kind: "location", id: l.id, label: l.name,
            address: l.address, fee: Number(l.delivery_fee) || 0,
          });
        }
      }

      if (areaOn) {
        out.push({
          kind: "custom", id: "custom",
          label: isPickup ? "Deliver to my address" : "Collect from my address",
          address: "", fee: 0,
        });
      }

      // An operator with nothing configured still needs a usable form, and the
      // engine accepts a typed address in that case.
      if (!out.length) {
        out.push({
          kind: "custom", id: "custom",
          label: isPickup ? "Pick-up address" : "Return address",
          address: "", fee: 0,
        });
      }
      return out;
    };

    const social: CbpLink[] = ([
      ["Facebook", settings.facebook_url], ["Instagram", settings.instagram_url],
      ["X", settings.twitter_url], ["LinkedIn", settings.linkedin_url],
      ["TikTok", settings.tiktok_url], ["YouTube", settings.youtube_url],
    ] as [string, string | null][])
      .filter((e): e is [string, string] => !!e[1])
      .map(([label, href]) => ({ label, href }));

    // The operator's switch in the portal (Settings → Rental / CMS → Blog).
    // This is the same gate /blog and /blog/[slug] enforce.
    const blogEnabled = !!tenant?.blog_enabled;

    // The same set, and the same conditions, the existing site's Navigation
    // applies: Promotions always; FAQ only when the tenant has active ones;
    // Blog only when the tenant has switched it on.
    const nav: CbpLink[] = [
      { label: "Home", href: CBP },
      { label: "Fleet", href: `${CBP}/fleet` },
      { label: "About", href: `${CBP}/about` },
      ...(reviews.length ? [{ label: "Reviews", href: `${CBP}/reviews` }] : []),
      { label: "Promotions", href: `${CBP}/promotions` },
      ...(hasFaqs ? [{ label: "FAQ", href: `${CBP}/faq` }] : []),
      ...(blogEnabled ? [{ label: "Blog", href: `${CBP}/blog` }] : []),
      { label: "Contact", href: `${CBP}/contact` },
    ];

    return {
      name,
      legalName: settings.company_name || null,
      legalEntityLine: getTenantLegalEntityLine(tenant?.slug),
      tagline: resolved ? settings.footer_tagline || null : null,
      logoUrl: resolved
        ? settings.light_logo_url || settings.logo_url || branding.logo_url
        : seed?.logoUrl ?? null,
      darkLogoUrl: resolved ? settings.dark_logo_url || null : null,
      // The dark-ground upload where the operator has one, else the light one:
      // most logos read acceptably on midnight, and a missing footer mark is
      // worse than a slightly low-contrast one.
      footerLogoUrl: resolved
        ? settings.dark_logo_url || settings.light_logo_url || settings.logo_url || branding.logo_url
        : seed?.logoUrl ?? null,
      // The operator answers this in the portal (Site settings → Logo). It is
      // not guessed: printing the name beside a logo that already contains it
      // duplicates it, and hiding it beside an icon-only mark leaves the
      // header anonymous. Default true — the safe half of that trade.
      showLogoName: (siteCms?.logo as { show_company_name?: boolean } | undefined)?.show_company_name !== false,


      hero: {
        headline, highlight,
        subheading: resolved
          ? rename(heroCms?.subheading) || branding.meta_description || ""
          : seed?.metaDescription || "",
        slides,
        bookCta: rename(heroCms?.book_cta_text) || "Book Now",
        fleetCta: "Explore Fleet",
        trustLine: rename(heroCms?.trust_line) || "",
        // The reference's three hero chips. The operator authors these as
        // trust badges; the trust line is split only as a fallback because
        // it is already a bullet list in most tenants' content.
        badges: (home?.trust_badges?.badges ?? []).map(b => rename(b.label)).filter(Boolean).slice(0, 3),
      },

      features: (home?.service_highlights?.services ?? [])
        .map(s => ({ icon: s.icon, title: rename(s.title), copy: rename(s.description) })),

      whyChoose: {
        title: rename(aboutCms?.why_choose_us?.title) || "",
        copy: rename(aboutCms?.about_story?.title) || "",
        items: (aboutCms?.why_choose_us?.items ?? [])
          .map(i => ({ icon: i.icon, title: rename(i.title), copy: rename(i.description) })),
      },

      stats,

      booking: {
        title: rename(home?.booking_header?.title) || "",
        subtitle: rename(home?.booking_header?.subtitle) || "",
        trustPoints: (home?.booking_header?.trust_points ?? []).map(p => rename(p)).filter(Boolean),
      },

      cta: {
        title: rename(home?.home_cta?.title) || "",
        description: rename(home?.home_cta?.description) || "",
        primary: rename(home?.home_cta?.primary_cta_text) || "Book Now",
        secondary: rename(home?.home_cta?.secondary_cta_text) || "",
      },

      about: {
        title: rename(aboutCms?.about_story?.title) || "",
        paragraphs: htmlParagraphs(aboutCms?.about_story?.content).map(rename),
        heroTitle: rename(aboutCms?.hero?.title) || "",
        heroSubtitle: rename(aboutCms?.hero?.subtitle) || "",
      },

      fleetPage: {
        title: rename(fleetCms?.fleet_hero?.headline) || "",
        subtitle: rename(fleetCms?.fleet_hero?.subheading) || "",
        // The editor keeps two named lists — standard and premium. Both are
        // things included with a hire, so they render as one grid here; the
        // items carry a title and an icon only, never a description.
        inclusions: [
          ...(fleetCms?.inclusions?.standard_items ?? []),
          ...(fleetCms?.inclusions?.premium_items ?? []),
        ].map(i => ({ icon: i.icon, title: rename(i.title), copy: "" })),
      },

      contact: {
        title: rename(contactCms?.hero?.title) || "",
        subtitle: rename(contactCms?.hero?.subtitle) || "",
      },

      offersPage: {
        title: rename(promoCms?.promotions_hero?.headline) || "",
        subtitle: rename(promoCms?.promotions_hero?.subheading) || "",
      },

      blogPage: {
        title: rename(blogCms?.hero?.title) || "",
        subtitle: rename(blogCms?.hero?.subtitle) || "",
      },

      legal: {
        privacy: privacyCms?.privacy_content?.content ?? null,
        terms: termsCms?.terms_content?.content ?? null,
      },

      phone,
      phoneDisplay: settings.phone_display || phone,
      phoneHref: phone ? phone.replace(/[^\d+]/g, "") : null,
      email,
      address,
      mapsUrl: settings.google_maps_url || (address ? "https://maps.google.com/?q=" + encodeURIComponent(address) : null),
      // The operator's OWN stored hours, not `settings.availability` — that
      // falls back to a stock "7 days a week", which for an operator who never
      // set hours would be a claim this page invented for them.
      hours: tenant?.business_hours || null,
      whatsapp: settings.whatsapp_number || null,
      weeklyHours,
      rentalTerms,

      vehicles,
      categories: Array.from(new Set(vehicles.map(v => v.category).filter((c): c is string => !!c))).sort(),
      pickupOptions: buildLocationOptions("pickup"),
      returnOptions: buildLocationOptions("return"),
      locations: locations.map(l => ({
        id: l.id, name: l.name, address: l.address,
        pickup: l.is_pickup_enabled, ret: l.is_return_enabled, fee: Number(l.delivery_fee) || 0,
      })),
      reviews,
      offers,
      articles,
      faqs,

      theme: toThemeConfig(tenant as unknown as Record<string, unknown> | null) ?? seed?.theme ?? null,

      nav,
      social,
      legalLinks: [
        { label: "Privacy Policy", href: `${CBP}/privacy` },
        { label: "Terms & Conditions", href: `${CBP}/terms` },
        { label: "SMS Terms", href: "/sms-opt-in" },
      ],
      copyright: resolved
        ? rename(settings.copyright_text) || `© ${new Date().getFullYear()} ${name}. All rights reserved.`
        : name ? `© ${new Date().getFullYear()} ${name}. All rights reserved.` : "",
      blogEnabled,

      fleetLoading,
      faqsLoading,
      articlesLoading,
      offersLoading,
      loading: tenantLoading || cmsLoading || fleetLoading || locationsLoading,
    };
  }, [
    tenant, branding, settings, home, aboutCms, fleetCms, contactCms, promoCms, blogCms, siteCms,
    privacyCms, termsCms, locations, workingHours, hasFaqs, vehicles, reviews,
    offers, articles, faqs, liveStats, name, rename, seed,
    tenantLoading, cmsLoading, fleetLoading, locationsLoading,
    faqsLoading, articlesLoading, offersLoading,
  ]);
}
