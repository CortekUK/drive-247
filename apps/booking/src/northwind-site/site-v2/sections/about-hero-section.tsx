import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@nw/components/ui/button";
import { DEFAULT_ABOUT_HERO, DEFAULT_SITE_SOCIAL } from "@nw/lib/cms/defaults";
import { loadSection } from "@nw/lib/cms/server";
import { socialLinks } from "@nw/lib/cms/social";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { SITE_CONTAINER } from "@nw/site-v2/kit";

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
 * v2 of `components/sections/about-hero-section.tsx` — the shared page top for
 * /about, /fleet, /promotions and /reviews. Same props, same CMS rule:
 * `about / hero` supplies the copy ONLY when the page passes no heading (so
 * only /about is operator-owned), and `site-settings / social` feeds the
 * follow row on every page.
 *
 * The look is the v2 PageIntro anatomy — a big title, one muted line, one
 * action — with the photograph as a calm rounded card beside it (under it on
 * phones) instead of a full-bleed washed-out background.
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

  const operatorOwned = heading === undefined;
  const resolvedHeading = heading ?? <Editable path="about.hero.title">{hero.title}</Editable>;
  const resolvedBody = body ?? <Editable path="about.hero.subtitle">{hero.subtitle}</Editable>;
  const socials = socialLinks(social);

  return (
    <section
      {...(operatorOwned ? cmsSection("about.hero", "Hero") : {})}
      className={`${SITE_CONTAINER} grid items-center gap-8 pt-10 md:pt-14 lg:grid-cols-[1fr_1fr] lg:gap-12`}
    >
      <div className="min-w-0">
        {topBadge ? <div className="mb-4 flex">{topBadge}</div> : null}
        <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.035em] text-pv-fg md:text-[44px]">
          {resolvedHeading}
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-pv-muted-fg md:text-base">{resolvedBody}</p>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-4">
          <Button asChild variant="brand" className="h-11 px-5">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>

          {socials.length > 0 && (
            <ul aria-label="Follow us" className="flex flex-wrap items-center gap-1.5">
              {socials.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <Link
                    href={href}
                    aria-label={label}
                    className="grid size-11 place-items-center rounded-full border border-pv-border bg-pv-card text-pv-muted-fg transition-colors duration-200 ease-out hover:bg-pv-hover hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
                  >
                    <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-pv-border bg-pv-muted">
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
          style={{ objectPosition: imageObjectPosition }}
        />
      </div>
    </section>
  );
}
