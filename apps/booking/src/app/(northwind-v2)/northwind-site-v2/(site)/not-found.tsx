import Link from "next/link";
import { Compass } from "lucide-react-nw";

import { Button } from "@nw/components/ui/button";
import { CARD, SITE_CONTAINER } from "@nw/site-v2/kit";

/**
 * The v2 404, inside the site's frame. A PageIntro-style heading and the two
 * places a lost visitor most likely wanted: home, and the cars.
 */
export default function SiteV2NotFoundPage() {
  return (
    <div className={`${SITE_CONTAINER} pt-10 md:pt-16`}>
      <div className={`${CARD} mx-auto flex max-w-xl flex-col items-center px-6 py-14 text-center md:py-16`}>
        <span className="grid size-12 place-items-center rounded-2xl bg-pv-tint text-pv-primary">
          <Compass className="size-5" />
        </span>
        <p className="mt-5 text-xs font-medium text-pv-muted-fg">Error 404</p>
        <h1 className="mt-2 text-[32px] font-bold leading-[1.1] tracking-[-0.035em] text-pv-fg md:text-[40px]">
          We can&apos;t find that page
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-pv-muted-fg">
          The address may have changed, or the page may no longer be here. Our cars and the home page are a click away.
        </p>
        <div className="mt-7 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button asChild variant="brand" className="h-11 px-5">
            <Link href="/fleet">Browse the fleet</Link>
          </Button>
          <Button asChild variant="brand-outline" className="h-11 px-5">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
