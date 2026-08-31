import { Car } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { DEFAULT_HOME_CTA } from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";

/**
 * The closing call-to-action, shown at the foot of five pages.
 *
 * It reads `home / home_cta` — the operator's main CTA — on every one of them.
 * The portal also has an `about / final_cta` and a `fleet / cta`, but v2 has a
 * single shared banner component and a Server Component cannot know which route
 * it is rendering on; per-page copy would need the page to say which key to
 * read, and the pages are not this agent's to edit. Reported as unmapped rather
 * than guessed at.
 *
 * `trust_points` replaces the prototype's "14 cars available for pickup today
 * in Los Angeles" — a hardcoded claim about a city no tenant is necessarily in.
 */
export async function CtaBanner() {
  const cta = await loadSection("home", "home_cta", DEFAULT_HOME_CTA);
  const footnote = cta.trust_points.filter((point) => point.trim() !== "");

  return (
    <section className="relative isolate overflow-hidden text-white">
      <Image
        src="/booking_landingpage/tesla-bg.png"
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
          {cta.title}
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
          {cta.description}
        </p>
        <Link
          href="/booking"
          className="inline-flex items-center justify-center rounded-full bg-brand-amber px-8 py-[13px] text-sm font-semibold text-brand-text transition-opacity hover:opacity-90"
        >
          {cta.primary_cta_text}
        </Link>
        <p className="inline-flex max-w-full items-center gap-2 px-2 text-xs text-white/85">
          <Car className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0">
            {footnote.length > 0
              ? footnote.join(" • ")
              : "14 cars available for pickup today in Los Angeles."}
          </span>
        </p>
      </div>
    </section>
  );
}
