"use client";

import { Plus_Jakarta_Sans } from "next/font/google";

import { captureSignup } from "@/lib/analytics";
import { BLACK_FRIDAY_BANNER_TEXT, BLACK_FRIDAY_CODE } from "@/lib/black-friday";
import { openSignup } from "@/lib/open-signup";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600"], display: "swap" });

/**
 * The thin Black Friday bar across the top of drive-247.com (desktop and
 * phone). Rendered by the landing page only while the offer is on, so it goes
 * by itself at the end (lib/black-friday.ts). Neema's brief: indigo #5B3DF5,
 * white text, Plus Jakarta Sans; no timer, no exclamation marks, no red. It sits
 * in the flow above the page, so it pushes the hero down and never covers the
 * headline or the signup button.
 */
export function BlackFridayBanner() {
  return (
    <div className={`${jakarta.className} bg-[#5B3DF5] text-white`} role="region" aria-label="Black Friday offer">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4 py-2 text-center text-[13px] leading-snug sm:text-sm">
        <p className="font-medium">{BLACK_FRIDAY_BANNER_TEXT}</p>
        <button
          type="button"
          onClick={() => {
            captureSignup("bf_banner_clicked", { promo_code: BLACK_FRIDAY_CODE });
            openSignup();
          }}
          className="inline-flex h-8 items-center rounded-full bg-white px-3.5 text-[13px] font-semibold text-[#5B3DF5] transition-colors duration-200 ease-out hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#5B3DF5] motion-reduce:transition-none"
        >
          Start free trial
        </button>
      </div>
    </div>
  );
}
