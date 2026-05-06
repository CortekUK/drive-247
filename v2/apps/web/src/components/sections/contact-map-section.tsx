import { CornerUpRight } from "lucide-react";
import Link from "next/link";

// Coordinate-based embed avoids Google's auto-generated place tooltip.
// (Dubai Silicon Oasis approx 25.118, 55.391)
const MAP_EMBED_SRC =
  "https://maps.google.com/maps?q=25.1180,55.3910&z=14&output=embed&iwloc=near";

const MAP_LINK =
  "https://www.google.com/maps/place/Dubai+Silicon+Oasis,+Dubai,+UAE";

export function ContactMapSection() {
  return (
    <section className="bg-brand-cream">
      <div className="container-page pb-12">
        <div className="relative overflow-hidden rounded-[16px] ring-1 ring-brand-border">
          <iframe
            src={MAP_EMBED_SRC}
            title="Drive247 location"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block h-[420px] w-full border-0 lg:h-[520px]"
          />

          {/* Overlay to mask Google Maps' default "Open in Maps" button (top-right
              of the iframe) and route the click to our own Google Maps link.
              Hidden on mobile where the address card already takes that area. */}
          <a
            href={MAP_LINK}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in Google Maps"
            className="absolute right-0 top-0 z-20 hidden h-10 w-28 bg-brand-cream sm:block"
          />

          <article className="pointer-events-auto absolute left-4 top-4 z-30 w-[calc(100%-2rem)] max-w-[280px] rounded-[12px] bg-white p-3 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-brand-border-soft sm:left-8 sm:top-8 sm:w-[320px] sm:max-w-none">
            <div className="flex gap-3">
              <div
                aria-hidden
                className="size-[68px] shrink-0 rounded-[8px] bg-[linear-gradient(135deg,#3a4f6b,#1a2638)] shadow-inner"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-brand-text">
                    Drive247
                  </h3>
                  <a
                    href={MAP_LINK}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-brand-progress-bar hover:underline"
                  >
                    <CornerUpRight className="size-3" strokeWidth={2} />
                    Directions
                  </a>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-brand-text-soft">
                  IFZA - Building A1 DDP - Dubai Silicon Oasis - Industrial Area
                  - Dubai - United Arab Emirates
                </p>
              </div>
            </div>

            <Link
              href={MAP_LINK}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-brand-forest px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Open in Google Maps
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
