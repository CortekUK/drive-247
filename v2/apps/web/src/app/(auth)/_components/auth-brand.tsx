"use client";

import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/TenantContext";

/**
 * The operator's mark at the top of the auth shell.
 *
 * A customer signing in believes they are signing in to the rental company, not
 * to Drive247 — so this shows the tenant's own logo and name when they have
 * one, and falls back to the platform mark only when they do not.
 *
 * The two branches are kept apart rather than wrapping one component in the
 * other because `BrandMark` is ITSELF a `<Link>`, and an anchor inside an
 * anchor is invalid HTML that React will re-parent during hydration.
 *
 * The logo is a plain `<img>`, not `next/image`: these URLs are
 * operator-supplied and live on arbitrary hosts, so they cannot be listed in
 * `images.remotePatterns` ahead of time. Same call, same reason, as
 * `components/fleet/vehicle-photo`.
 */
export function AuthBrand() {
  const { tenant, isLoading } = useTenant();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="size-10 rounded-full bg-brand-stone" />
        <Skeleton className="h-4 w-32 bg-brand-stone" />
      </div>
    );
  }

  const name = tenant?.company_name ?? tenant?.app_name ?? null;
  const logo = tenant?.logo_url ?? null;

  return (
    <div className="flex flex-col items-center gap-2">
      {logo ? (
        <Link
          href="/"
          aria-label={name ? `${name} home` : "Home"}
          className="inline-flex rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25"
        >
          <img
            src={logo}
            alt=""
            className="h-10 w-auto max-w-[180px] object-contain"
          />
        </Link>
      ) : (
        <BrandMark href="/" className="size-11 rounded-lg" />
      )}
      {name ? (
        <span className="text-sm font-medium text-brand-text">{name}</span>
      ) : null}
    </div>
  );
}
