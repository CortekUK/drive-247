"use client";

import { TraxPanel } from "./trax-panel";
import { TraxScene } from "./trax-scene";

/*
 * "Meet Trax": the first section of the rebuilt v2 page.
 *
 * Built step by step, only what Ghulam asks for (2026-10-08). The whole of
 * Trax lives inside one 100vw x 100vh frame. Split in two:
 *   left   from the top: the "Meet Trax." heading, its description, and the
 *          illustration (trax-scene.tsx, ILLUSTRATION_GUIDE.md)
 *   right  the Trax panel (trax-panel.tsx), running an endless conversation
 *          where Trax pulls the data and shows it
 * On phones the two stack, heading first.
 */

export function TraxSection() {
  return (
    <section id="trax" className="h-screen w-full overflow-hidden text-white">
      <div className="mx-auto grid h-full max-w-7xl grid-rows-[auto_1fr] items-stretch gap-8 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:grid-rows-1 lg:gap-16 lg:py-12">
        {/* Left: the introduction (first on phones too). */}
        <div className="flex h-full min-h-0 flex-col text-center lg:text-left">
          <h2 className="whitespace-nowrap text-[56px] font-black leading-[0.9] tracking-[-0.05em] text-white sm:text-[96px] lg:text-[84px] xl:text-[112px]">
            Meet Trax.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[19px] font-medium leading-[1.45] text-white/85 sm:text-[22px] lg:mx-0 lg:mt-8 lg:max-w-none">
            Your assistant inside Drive247. It reads your records, so it knows your cars, your bookings and your money. Ask it
            anything.
          </p>
          <div className="mt-10 hidden min-h-0 flex-1 items-center lg:flex">
            <TraxScene />
          </div>
        </div>

        {/* Right: the Trax panel, as it looks in the app. */}
        <div className="flex h-full min-h-0 justify-center lg:items-center lg:justify-end">
          <TraxPanel />
        </div>
      </div>
    </section>
  );
}
