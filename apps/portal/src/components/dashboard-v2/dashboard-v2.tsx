"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui-v2/button";
import { Plus } from "lucide-react";

import { useManagerPermissions } from "@/hooks/use-manager-permissions";
// v1 components, imported and not edited. These are operational alerts that
// must survive a visual refresh — see the note above the JSX.
import { LowCreditsBanner } from "@/components/dashboard/low-credits-banner";
import { BonzahStatusBanner } from "@/components/dashboard/bonzah-status-banner";
import { BonzahPendingAlert } from "@/components/dashboard/bonzah-pending-alert";
import { HomeBands } from "@/components/dashboard-v2/home/home-bands";
import { HOME_PALETTE } from "@/components/dashboard-v2/home/ui";

/**
 * The v2 dashboard body.
 *
 * Rendered by `(dashboard)/page.tsx` when `useV2('dashboard')` is true — i.e.
 * for the `northwind` canary only. It is a component rather than a page because
 * the v1 route keeps ownership of the URL, which is what makes the gate a
 * single deletable branch (V2_PLAN §3).
 *
 * The body is three named bands (`HomeBands`) on their own palette, injected
 * as a `<style>` block scoped to `.pv` so those tokens cannot leak into the
 * rest of the portal.
 *
 * There is no hero above the bands any more. The time-of-day greeting, the
 * date and time line, the Open / Closed availability pill and the Setup guide
 * button were removed on request, together with the code that only fed them
 * (the greeting, the working-hours query and the setup-guide visibility).
 * `setup-guide.tsx` and `use-setup-guide.ts` are left in place, just not
 * mounted here. New Rental moved onto the first band's title row.
 */

export function DashboardV2() {
  const router = useRouter();
  const { canEdit } = useManagerPermissions();

  // The dashboard's one labelled action. It used to give its slot up to the
  // Setup guide until setup was finished; with the guide off the dashboard it
  // shows whenever the operator can create a rental.
  const newRental = canEdit("rentals") ? (
    <Button size="lg" className="gap-2 rounded-full" onClick={() => router.push("/rentals/new")}>
      <Plus className="size-4" /> New Rental
    </Button>
  ) : null;

  return (
    /* Switch row alignment: at md+ the first band title ("On your desk", a 26px
       line box) is centred on the sidebar's Portal / Website switch, 92px from
       the top. main's content box starts at 50px there, so 50 + 29 + 13 = 92,
       measured in headless Chrome (New Rental, 40px, spans 72-112, the switch's
       own rows). Below md the wrapper keeps no top padding. A banner, when one
       shows, renders first and pushes the bands down. */
    <div className="mx-auto w-full max-w-[1560px] space-y-10 px-2 pb-4 md:pt-[29px]">
      {/*
        Operational alerts stay above the redesign. These are the banners that
        tell a tenant their credits are running out, or that Bonzah has made a
        decision on their onboarding — losing them to a visual refresh would be
        a functional regression, not a style change.
      */}
      <LowCreditsBanner />
      <BonzahStatusBanner />
      <BonzahPendingAlert />

      {/* Three named bands — Important, Today, Stats — on their own scoped
          palette. `.pv` keeps those tokens off the rest of the portal. */}
      <div className="pv">
        <HomeBands aside={newRental} />
      </div>
      {/* The palette goes LAST. `space-y-10` gives every child after the first
          a 40px top margin, and a <style> element counts as a child, so ahead of
          `.pv` it pushed the first band 40px down under nothing visible. It
          still styles the whole document from here. */}
      <style>{HOME_PALETTE}</style>
    </div>
  );
}
