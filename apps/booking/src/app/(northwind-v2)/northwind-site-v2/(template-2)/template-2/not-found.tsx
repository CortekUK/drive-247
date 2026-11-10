import Link from "next/link";
import { ArrowRight } from "lucide-react-nw";

import { cn } from "@nw/lib/utils";
import { T2_HOME, t2Href } from "@nw/template-2/links";

/**
 * Template 2 ("Glass") — a page that is not here: what happened in one line,
 * and the two places most people were heading, the cars or the home page.
 * No drawing: this design has none.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50";

export default function Template2NotFoundPage() {
  return (
    <div className="pb-3">
      <section className="mx-auto w-full max-w-[1320px] px-3 pt-[84px] sm:px-5 sm:pt-[96px]">
        <div className="g2-glass flex min-h-[60svh] flex-col items-center justify-center rounded-[32px] px-5 py-16 text-center sm:rounded-[44px] lg:rounded-[40px]">
          <h1 className="max-w-[16ch] text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[56px]">
            We can&rsquo;t find that page.
          </h1>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance]">
            The address may have changed, or the page is no longer here. Our cars are one click away.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={t2Href("/fleet")} className={cn("g2-cta inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold", FOCUS)}>
              See our cars
              <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
            </Link>
            <Link
              href={T2_HOME}
              className={cn(
                "inline-flex h-12 items-center rounded-full bg-white px-6 text-[15px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff]",
                FOCUS,
              )}
            >
              Go to the home page
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
