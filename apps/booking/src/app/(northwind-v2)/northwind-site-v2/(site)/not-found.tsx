import Link from "next/link";

import { NotFoundArt } from "@nw/site-v2/illustrations/page-scenes";
import { PAGE_TOP_SURFACE, PILL_DARK, PILL_LIGHT, SITE_WIDE } from "@nw/site-v2/kit";

/**
 * Northwind booking site v2 — a page that is not here: the drawn car at a
 * signpost with a question mark, what happened in one line, and the two
 * places most people were heading — the cars, or the home page.
 */
export default function SiteV2NotFoundPage() {
  return (
    <div className={PAGE_TOP_SURFACE}>
      <div className={`${SITE_WIDE} flex flex-col items-center pb-16 pt-10 text-center md:pb-24 md:pt-16`}>
        <div className="nw-live w-full max-w-[420px]">
          <NotFoundArt />
        </div>
        <h1 className="mt-8 text-[36px] font-extrabold leading-[1.05] tracking-[-0.05em] text-pv-fg [text-wrap:balance] sm:text-[48px]">
          We can&apos;t find that page
        </h1>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-pv-muted-fg">
          The address may have changed, or the page is no longer here. Our cars are one click away.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/fleet" className={PILL_DARK}>
            See our cars
          </Link>
          <Link href="/" className={PILL_LIGHT}>
            Go to the home page
          </Link>
        </div>
      </div>
    </div>
  );
}
