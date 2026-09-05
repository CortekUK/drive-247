import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { DEFAULT_ABOUT_HERO, DEFAULT_SITE_SOCIAL } from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";
import { socialLinks } from "@/lib/cms/social";
import { Editable, cmsSection } from "@/lib/cms/editable";

type AboutHeroSectionProps = {
  imageSrc?: string;
  imageAlt?: string;
  imageObjectPosition?: string;
  heading?: ReactNode;
  body?: ReactNode;
  topBadge?: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
};

/**
 * The shared page hero — /about, /fleet, /promotions and /reviews all use it.
 *
 * CMS wiring has to respect that sharing. `about / hero` supplies the copy ONLY
 * when the page has not passed its own: /about passes nothing and so becomes
 * operator-controlled, while /fleet, /promotions and /reviews pass explicit
 * headings and keep them. Reading `about / hero` unconditionally would put the
 * about-page headline on all four.
 *
 * (The portal does have a `fleet / hero` and a `promotions / hero`. Wiring
 * those needs the pages to stop hardcoding their copy, which is a one-line edit
 * in files this agent does not own — see the coverage report.)
 *
 * The social row is genuinely shared, so it reads `site-settings / social` on
 * every page that renders this hero.
 */
export async function AboutHeroSection({
  imageSrc = "/booking_landingpage/about-hero.jpg",
  imageAlt = "",
  imageObjectPosition = "70% center",
  heading,
  body,
  topBadge,
  ctaLabel = "Rent a Car",
  ctaHref = "/booking",
}: AboutHeroSectionProps = {}) {
  const [hero, social] = await Promise.all([
    loadSection("about", "hero", DEFAULT_ABOUT_HERO),
    loadSection("site-settings", "social", DEFAULT_SITE_SOCIAL),
  ]);

  // Only the /about page leaves these undefined and so reads the CMS; the
  // other pages pass their own copy, which is not editable here.
  const operatorOwned = heading === undefined;
  const resolvedHeading = heading ?? (
    <Editable path="about.hero.title">{hero.title}</Editable>
  );
  const resolvedBody = body ?? <Editable path="about.hero.subtitle">{hero.subtitle}</Editable>;
  const socials = socialLinks(social);

  return (
    <section
      {...(operatorOwned ? cmsSection("about.hero", "Hero") : {})}
      className="relative isolate -mt-[88px] overflow-hidden bg-brand-text"
    >
      {/* Background image — pulled up under the navbar so the navbar
          appears blended on top of the hero image */}
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover"
        style={{ objectPosition: imageObjectPosition }}
      />
      {/* Cream wash overlay — keeps the subject visible but tints the whole
          image with the page's brand-cream color so the navbar blends in */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-brand-cream/55"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-brand-cream via-brand-cream/45 to-transparent"
      />

      <div className="container-page relative flex min-h-[500px] flex-col justify-end gap-6 pb-12 pt-[120px] sm:min-h-[560px] lg:min-h-[680px] lg:pb-20 lg:pt-[160px]">
        {topBadge && <div className="mb-2 flex">{topBadge}</div>}

        <div className="flex max-w-[640px] flex-col gap-4">
          <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-brand-text sm:text-4xl lg:text-[58px]">
            {resolvedHeading}
          </h1>
          <p className="max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            {resolvedBody}
          </p>
        </div>

        <Link
          href={ctaHref}
          className="inline-flex w-fit items-center justify-center rounded-full bg-brand-forest px-7 py-[13px] text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {ctaLabel}
        </Link>

        <div className="mt-6 flex items-center gap-4">
          <span className="text-[13px] text-brand-text-soft">Follow us:</span>
          <ul className="flex flex-wrap items-center gap-3">
            {socials.map(({ key, href, label, Icon }) => (
              <li key={key}>
                <Link
                  href={href}
                  aria-label={label}
                  className="inline-flex size-8 items-center justify-center rounded-full bg-brand-text text-white transition-opacity hover:opacity-85"
                >
                  <Icon className="size-3.5" strokeWidth={2} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
