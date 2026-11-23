"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { replayFirstRentalTour } from "@/hooks/use-first-rental-tour";
import { FAKE_QUICK_TOUR_TENANT, profileFromSearch, startFakeQuickTour } from "@/lib/fake-quick-tour";

/**
 * `/fake-quick-tour` — replays the quick tour from its first step, with every
 * dialog kept shut, so it can be iterated on. Northwind only; any other tenant
 * is sent home. See `lib/fake-quick-tour.ts` for what the run changes.
 *
 * The tour is the real one (FirstRentalTour, mounted by the dashboard layout):
 * whatever we change while iterating is what a new company gets.
 *
 *   /fake-quick-tour                     no Stripe, call not booked (default)
 *   /fake-quick-tour?call=booked         no Stripe, call booked
 *   /fake-quick-tour?stripe=connected    Stripe connected
 *   /fake-quick-tour?call=none           no call on offer
 */

const TOUR_ON_SCREEN = "[data-first-rental-tour], [data-tour-transit]";
const TRY_EVERY_MS = 500;
const MAX_TRIES = 6;

export default function FakeQuickTourPage() {
  const router = useRouter();
  const { tenant } = useTenant();
  const [failed, setFailed] = useState(false);
  const allowed = tenant?.slug === FAKE_QUICK_TOUR_TENANT;

  useEffect(() => {
    if (!tenant) return;
    if (!allowed) {
      router.replace("/");
      return;
    }
    // `?stripe=connected` / `?call=booked|none` try the other versions of the
    // last card and the dashboard card. The default is a brand-new company.
    startFakeQuickTour(profileFromSearch(window.location.search));
    // The tour's listener attaches in the same commit as this page, and may
    // not be ready on the first try. Ask again until its card or its
    // "Heading to…" pill is on screen. Starting it navigates home, which
    // unmounts this page and clears the timer.
    let tries = 0;
    const ask = () => {
      if (document.querySelector(TOUR_ON_SCREEN)) return true;
      if (tries >= MAX_TRIES) {
        setFailed(true);
        return true;
      }
      tries += 1;
      replayFirstRentalTour();
      return false;
    };
    if (ask()) return;
    const id = window.setInterval(() => {
      if (ask()) window.clearInterval(id);
    }, TRY_EVERY_MS);
    return () => window.clearInterval(id);
  }, [tenant, allowed, router]);

  if (!allowed) return null;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">
        {failed
          ? "The quick tour did not start. Refresh this page to try again."
          : "Starting the quick tour…"}
      </p>
    </div>
  );
}
