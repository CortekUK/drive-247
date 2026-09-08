"use client";

import Link from "next/link";

import { useCmsSection } from "@/hooks/use-cms";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { DEFAULT_SITE_LOGO } from "@/lib/cms/defaults";
import type { PageSections } from "@/lib/cms/types";
import { cn } from "@/lib/utils";

/**
 * The mark in the top-left of a tenant's website.
 *
 * ── it was ours, on their site ──────────────────────────────────────────────
 *
 * This rendered a fixed Drive247 asterisk with `aria-label="Drive247 home"`, on
 * every tenant, always — so an operator who had uploaded their logo in
 * Site Settings still saw our mark in their own header, and a screen-reader
 * user was told our company name. The tenant's logo was never read here at all.
 *
 * `logo_url` is already loaded by `useTenantBranding`; this just uses it.
 *
 * ── why the asterisk survives as the fallback ───────────────────────────────
 *
 * A tenant who has not uploaded a logo yet still needs something clickable in
 * the corner, and an empty header reads as a broken page. The shipped mark is
 * geometric — a four-line asterisk, no wordmark, no name — so it carries no
 * brand of ours the way a logotype would. The ACCESSIBLE NAME still becomes the
 * tenant's, because that is what a screen reader announces and what must never
 * say "Drive247" on someone else's site.
 */
type BrandMarkProps = {
  href?: string;
  className?: string;
  /** Server-rendered `site-settings` sections — see `(booking)/layout.tsx`. */
  seed?: PageSections | null;
  /** The tenant's name, resolved on the server for the same reason. */
  nameSeed?: string | null;
  /**
   * Show the tenant's name BESIDE the logo, rather than only in place of it.
   *
   * Off by default because the other two callers put this in a fixed square —
   * `auth-brand` passes `size-11`, and the portal shell has its own name in the
   * sidebar — so text inside the box would overflow or be said twice. The site
   * header opts in.
   */
  withName?: boolean;
};

export function BrandMark({
  href = "/",
  className,
  seed,
  nameSeed,
  withName = false,
}: BrandMarkProps) {
  const { appName: clientName, logoUrl: tenantLogoUrl } = useTenantBranding();
  /* The server's value first render, the live one thereafter. They agree, so
     nothing flickers; without the seed the first render has no name at all. */
  const appName = clientName || nameSeed || null;
  /**
   * The CMS is the source, and `tenants.logo_url` is the fallback — in that
   * order, because they are two different stores and only one of them is what
   * the operator actually edits.
   *
   * Site Settings -> Logo writes `cms_page_sections` (page `site-settings`,
   * key `logo`). Reading only `tenants.logo_url` meant an operator could upload
   * their logo, see it saved, publish it, and still get our asterisk: for
   * Northwind the CMS row holds a real file while the tenant column is NULL.
   */
  const { content: logo } = useCmsSection("site-settings", "logo", DEFAULT_SITE_LOGO, seed);

  const logoUrl = logo.logo_url.trim() || tenantLogoUrl || null;
  /* Alt text the operator typed wins; then their name. Never ours, and never
     the file name. */
  const label = logo.logo_alt.trim() || (appName ? `${appName} home` : "Home");

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn("inline-flex items-center justify-center gap-2.5", className)}
    >
      {logoUrl ? (
        /* Height-bounded rather than sized: logos arrive at every aspect ratio,
           and a square box would letterbox a wide wordmark or crop a tall one.
           eslint-disable-next-line @next/next/no-img-element — the URL is
           tenant-supplied Supabase storage, which the Image loader would need
           configured per host. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          /*
           * 40px, not the 28px this started at.
           *
           * 28 was the shipped asterisk's box — fine for a square glyph, far
           * too small for a wordmark: a logo with the company name in it came
           * out as an illegible smudge, because a wide image bounded to 28px
           * of height has letters a couple of pixels tall.
           *
           * Bounded on BOTH axes so neither a tall square nor a very wide
           * banner can push the header around, and `object-contain` so nothing
           * is ever cropped — a cropped logo is worse than a small one.
           */
          className="max-h-10 w-auto max-w-[200px] object-contain"
        />
      ) : appName ? (
        /*
         * No logo: the tenant's NAME, set as a wordmark.
         *
         * The shipped asterisk used to fill this slot, and it is our glyph —
         * an operator who removes their logo got a mark belonging to us, on
         * their own header, with nothing telling a visitor whose site they are
         * on. Their name is both more useful and more honest, and it needs no
         * upload: every tenant has one.
         *
         * `whitespace-nowrap` because a two-word name wrapping under itself
         * would double the header's height on a narrow screen.
         */
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight text-brand-text">
          {appName}
        </span>
      ) : (
        /* Neither a logo nor a name — a brand-new tenant who has filled in
           nothing. The glyph is a placeholder so the corner is not empty and
           the link is still clickable; it carries no wordmark of ours. */
        <svg
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M14 3.5V24.5"
            stroke="#131B16"
            strokeWidth="4.66667"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3.5 14H24.5"
            stroke="#131B16"
            strokeWidth="4.66667"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6.57532 6.57422L21.4247 21.4236"
            stroke="#131B16"
            strokeWidth="4.66667"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M21.4247 6.57422L6.57532 21.4236"
            stroke="#131B16"
            strokeWidth="4.66667"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/*
        The name beside the logo, when the caller asks for it.
        `logoUrl &&` because without a logo the name IS the mark above — showing
        it here too would print it twice.
      */}
      {withName && logoUrl && appName && (
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight text-brand-text">
          {appName}
        </span>
      )}
    </Link>
  );
}
