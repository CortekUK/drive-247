import { Car } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { DEFAULT_HOME_CTA, HOME_CTA_FOOTNOTE_FALLBACK } from "@/lib/cms/defaults";
import { completeLines } from "@/lib/cms/merge";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsImage, cmsSection } from "@/lib/cms/editable";

/**
 * The closing call-to-action, shown at the foot of five pages.
 *
 * `home / home_cta` is the base: it owns the photograph and the button, which
 * are shared design, and it is the whole of the banner on the home page.
 *
 * A page that has its OWN closing copy in the portal passes `page`, and that
 * page's fields win over the shared ones. Without this the About page's
 * `final_cta` had no consumer at all — an operator could write a heading, a
 * description and a tagline, publish, and watch the page keep saying the home
 * page's words. A Server Component cannot tell which route it is on, so the
 * route has to say.
 *
 * `trust_points` replaces the prototype's "14 cars available for pickup today
 * in Los Angeles" — a hardcoded claim about a city no tenant is necessarily in.
 */
/** Pages whose own closing copy overrides the shared banner's. */
const PAGE_CTA = {
  about: { slug: "about", key: "final_cta" },
  fleet: { slug: "fleet", key: "cta" },
} as const;

export async function CtaBanner({ page }: { page?: keyof typeof PAGE_CTA } = {}) {
  const shared = await loadSection("home", "home_cta", DEFAULT_HOME_CTA);

  /* Blank fields fall through to the shared copy rather than emptying the
     banner: a half-filled `final_cta` must not leave a heading with no words
     under it. */
  const own = page
    ? await loadSection(PAGE_CTA[page].slug as "about", PAGE_CTA[page].key, {
        title: "",
        description: "",
        tagline: "",
      })
    : null;

  /* Where this banner's copy is edited, so the visual editor sends a click to
     the field the page is actually rendering. */
  const path = page ? `${PAGE_CTA[page].slug}.${PAGE_CTA[page].key}` : "home.home_cta";

  const cta = {
    ...shared,
    title: own?.title?.trim() || shared.title,
    description: own?.description?.trim() || shared.description,
  };

  /* The About page calls its footnote a "tagline"; the home page keeps a list
     of trust points. One line beats an empty list. */
  const ownTagline = own?.tagline?.trim() ?? "";
  // Kept with their STORED index: the editor writes back by position, and a
  // filtered list would point an edit at the wrong entry once a blank exists.
  const footnote = ownTagline
    ? [{ point: ownTagline, index: 0 }]
    : completeLines(cta.trust_points, DEFAULT_HOME_CTA.trust_points)
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => point.trim() !== "");

  return (
    <section {...cmsSection(path, "Call to action")} className="relative isolate overflow-hidden text-white">
      {/*
        A `fill` image at -z-20 behind a black scrim: unreachable by a click
        where it sits, which is why the overlay draws its handle in a layer of
        its own rather than relying on the image taking pointer events.
      */}
      <Image
        {...cmsImage("home.home_cta.background_image", cta.background_image)}
        src={cta.background_image}
        alt=""
        fill
        priority={false}
        sizes="100vw"
        className="-z-20 scale-105 object-cover object-center blur-[6px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-black/55"
      />

      <div className="container-page relative flex flex-col items-center gap-6 py-24 text-center lg:py-32">
        <h2 className="max-w-3xl font-sans text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl lg:leading-none">
          <Editable path={`${path}.title`}>{cta.title}</Editable>
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
          <Editable path={`${path}.description`}>{cta.description}</Editable>
        </p>
        {/*
          Two buttons, because the CMS has always offered two.
          `secondary_cta_text` was editable on every one of these sections and
          rendered NOWHERE — an operator typed "Browse the fleet", saved,
          published, and still got one button. It appears only once they have
          written something, so a tenant who leaves it blank keeps the
          single-button design exactly as it is today.

          Both labels are read from `home / home_cta` even on a page with its
          own heading: `about / final_cta` has no button fields at all, so
          per-page buttons would simply disappear there.
        */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/booking"
            className="inline-flex items-center justify-center rounded-full bg-brand-amber px-8 py-[13px] text-sm font-semibold text-brand-text transition-opacity hover:opacity-90"
          >
            <Editable path="home.home_cta.primary_cta_text">{cta.primary_cta_text}</Editable>
          </Link>

          {cta.secondary_cta_text.trim() !== "" && (
            /* Outlined, not filled: two solid buttons side by side give a
               visitor no steer on which one to press. */
            <Link
              href="/fleet"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-8 py-[13px] text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Editable path="home.home_cta.secondary_cta_text">
                {cta.secondary_cta_text}
              </Editable>
            </Link>
          )}
        </div>
        <p className="inline-flex max-w-full items-center gap-2 px-2 text-xs text-white/85">
          <Car className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0">
            {footnote.length > 0 ? (
              footnote.map(({ point, index }, i) => (
                <span key={index}>
                  {i > 0 && " • "}
                  <Editable
                    path={
                      ownTagline
                        ? `${path}.tagline`
                        : `home.home_cta.trust_points.${index}`
                    }
                  >
                    {point}
                  </Editable>
                </span>
              ))
            ) : (
              /*
                The shipped claim, and it is editable: writing over it CREATES
                `trust_points[0]`, which is what the operator means when they
                change the line in front of them. Left as a fallback rather
                than seeded into the default array because an empty array is
                what tells `mergeContent` the operator has written nothing.
              */
              <Editable path="home.home_cta.trust_points.0">
                {HOME_CTA_FOOTNOTE_FALLBACK}
              </Editable>
            )}
          </span>
        </p>
      </div>
    </section>
  );
}
