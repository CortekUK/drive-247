import { Facebook, Instagram, Twitter, Youtube } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const SOCIALS = [
  { Icon: Youtube, href: "#", label: "YouTube" },
  { Icon: Instagram, href: "#", label: "Instagram" },
  { Icon: Facebook, href: "#", label: "Facebook" },
  { Icon: Twitter, href: "#", label: "X" },
];

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

export function AboutHeroSection({
  imageSrc = "/booking_landingpage/about-hero.jpg",
  imageAlt = "",
  imageObjectPosition = "70% center",
  heading = "The Pinnacle of Luxury Mobility.",
  body = "Founded in 2010 to provide the highest standard of premium vehicle rentals with unmatched flexibility and discretion.",
  topBadge,
  ctaLabel = "Rent a Car",
  ctaHref = "/booking",
}: AboutHeroSectionProps = {}) {
  return (
    <section className="relative isolate -mt-[88px] overflow-hidden bg-brand-text">
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
            {heading}
          </h1>
          <p className="max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            {body}
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
          <ul className="flex items-center gap-3">
            {SOCIALS.map(({ Icon, href, label }) => (
              <li key={label}>
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
