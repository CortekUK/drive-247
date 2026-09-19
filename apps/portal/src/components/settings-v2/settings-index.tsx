"use client";

/**
 * Settings index — the v2 (northwind) landing page for `/settings`.
 *
 * Laid out like Stripe's settings page: a few named sections, each a grid of
 * entries with a title and one line saying what is behind it. It replaces the
 * settings rail that used to take over the sidebar, so the app's own sidebar
 * stays on screen the whole time.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *  - Anything an Integrations card manages: Stripe Connect / Square, Twilio,
 *    Bonzah, BoldSign, Tesla, Xero / Zoho, INSHUR. Those are configured in
 *    their dialog on `/integrations` and nowhere else. The tabs still exist for
 *    the other tenants, and `isSettingsTabHidden` is applied below as well, so
 *    an entry mapped to one of them can never appear here by accident.
 *  - Subscription — the sidebar's Billing page is the same screen.
 *  - Portal appearance as a separate entry — it edits the same name, logo,
 *    favicon and colours as Branding, so Branding opens it.
 *  - Driver requirements — a tab of General (`?tab=requirements` opens it).
 *  - Tax and fees and Security deposit as two entries — one page, Tax and
 *    deposit (`?tab=fees` and `?tab=preauth` still open it).
 *  - The global blacklist — out of Settings for now (it is to move to
 *    Customers). A `?tab=blacklist` link says it isn't part of the workspace.
 *
 * Business reads in rows of three: who you are (General, Branding,
 * Locations), how a rental runs (Booking rules, Lockbox, Tax and deposit),
 * then the rest (Booking site, Optional modules, Team). Booking rules, Lockbox
 * (was Key handover), Tax and deposit, Booking site and Optional modules were
 * sections of General for a while (Sep 17 to 19 2026) and are pages again.
 *
 * Promo codes, Extras, Installments, Pay as you go and Auto-extension were
 * hidden for a while (V2_HIDDEN_SETTINGS_PAGES, now empty) and are listed
 * again: what a customer is charged under Pricing, and how and when they pay
 * under Payment plans.
 *
 * Every description is 95–120 characters and wraps to two or three lines in
 * its 320px column.
 */

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import {
  SettingsDependencyNotice,
  SettingsEmptyState,
  SettingsNoMatch,
} from "@/components/settings-v2/section-states";
import {
  V2_GENERAL_PERM_TABS,
  V2_TAX_AND_DEPOSIT_PERM_TABS,
  findSettingsSearchHandoff,
} from "@/components/settings-v2/settings-shell-state";
import { SETTINGS_PAGE_TITLE, SETTINGS_SECTION_TITLE } from "@/components/settings-v2/settings-kit";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { isSettingsTabHiddenForLean } from "@/lib/lean-areas";
import { useIsLean } from "@/lib/lean-context";

export interface SettingsIndexItem {
  title: string;
  description: string;
  href: string;
  /** The v1 settings tab whose permission and lean gate this entry follows. */
  tab: string;
  /**
   * The entry opens a page made of sections with their own permissions
   * (General, Tax and deposit): it is listed when ANY of these tabs is
   * viewable. `tab` still drives the lean gate.
   */
  anyOfTabs?: readonly string[];
  /** Listed for head admins only (Team: `/users` refuses everyone else). */
  headAdminOnly?: boolean;
  keywords?: string;
  tourAnchor?: string;
}

export interface SettingsIndexSection {
  title: string;
  items: SettingsIndexItem[];
}

export const SETTINGS_INDEX_SECTIONS: SettingsIndexSection[] = [
  {
    title: "Business",
    items: [
      {
        title: "General",
        description:
          "Your currency and distance unit, plus the minimum driver age and the ID customers verify before they drive.",
        href: "/settings?tab=general",
        tab: "general",
        anyOfTabs: V2_GENERAL_PERM_TABS,
        keywords:
          "regional currency dollar distance miles kilometres km " +
          "driver requirements age licence license passport id verification waiver",
      },
      {
        title: "Branding",
        // The Branding page calls them "Square icon" and "Full logo"; "favicon"
        // stays in the keywords only, so a search for it still finds this page.
        description: "Your portal name, square icon, full logo and brand colour, shown in this portal and on your customer booking site.",
        href: "/settings/appearance",
        tab: "branding",
        keywords: "logo full logo square icon colour color theme appearance name favicon",
        tourAnchor: "settings-tab-branding",
      },
      {
        title: "Locations",
        description: "Where customers pick up and return cars, the areas you deliver to, and what you charge for delivery.",
        href: "/settings?tab=locations",
        tab: "locations",
        keywords: "pickup return delivery address collection",
      },
      {
        title: "Booking rules",
        description: "How far ahead customers must book, the shortest and longest rental, and the time a car rests between rentals.",
        href: "/settings?tab=duration",
        tab: "duration",
        keywords: "booking rules advance notice lead time duration minimum maximum shortest longest buffer cooldown gap",
      },
      {
        title: "Lockbox",
        description: "Leave the keys in a lockbox for delivery rentals, choose the code length, and email the code to the customer.",
        href: "/settings?tab=lockbox",
        tab: "lockbox",
        keywords: "lockbox key handover keys code length delivery email",
      },
      {
        title: "Tax and deposit",
        description: "Sales tax and service fees added to every booking, and the security deposit held or charged on online bookings.",
        href: "/settings?tab=tax-and-deposit",
        tab: "fees",
        anyOfTabs: V2_TAX_AND_DEPOSIT_PERM_TABS,
        keywords: "tax vat sales service fee fees security deposit hold pre-authorisation preauth charge",
      },
      {
        title: "Booking site",
        description: "What customers see on your booking site: daily prices, the checkout breakdown, plate numbers and header colours.",
        href: "/settings?tab=booking-site",
        tab: "general",
        keywords: "booking site website gig driver price breakdown average daily plate vin registration header footer colour",
      },
      {
        title: "Optional modules",
        description: "Add extra pages to your sidebar, such as vehicle owners and payouts, fleet health checks or Turo Sync.",
        href: "/settings?tab=modules",
        tab: "general",
        keywords: "optional modules turo fleet health vehicle owners payouts",
      },
      {
        title: "Team",
        description: "Add people to your portal, choose what each person can see and change, and reset their passwords.",
        href: "/users",
        tab: "team",
        headAdminOnly: true,
        keywords: "users team staff members roles permissions manager invite password",
      },
    ],
  },
  {
    // What a customer is charged: surcharges, discounts and add-ons.
    title: "Pricing",
    items: [
      {
        title: "Custom pricing",
        description: "Charge more on weekends and holidays, and choose the rental length at which your monthly rate starts.",
        href: "/settings?tab=pricing",
        tab: "pricing",
        keywords: "custom pricing dynamic seasonal weekend holiday surcharge monthly tier rate",
      },
      {
        title: "Promo codes",
        description: "Create discount codes customers enter at checkout, or discounts that apply by themselves on longer rentals.",
        href: "/settings?tab=promos",
        tab: "promos",
        keywords: "promo promotion discount coupon voucher code offer",
      },
      {
        title: "Extras",
        description: "Add-ons customers can buy with a rental, such as child seats or GPS, and the price of each one.",
        href: "/settings?tab=extras",
        tab: "extras",
        keywords: "extras add-ons addons add ons child seat baby seat gps stock",
      },
    ],
  },
  {
    // How and when a customer pays. Not "Payments": the payment provider
    // (Stripe, Square) is set up in Integrations, which the footer says.
    title: "Payment plans",
    items: [
      {
        title: "Installments",
        description: "Let customers split the cost of a longer rental into weekly or monthly payments instead of paying it all at once.",
        href: "/settings?tab=installments",
        tab: "installments",
        keywords: "installment installments instalment split payment plan weekly monthly",
      },
      {
        title: "Pay as you go",
        description: "Bill long rentals day by day while the car is out, instead of asking the customer to pay everything upfront.",
        href: "/settings?tab=payg",
        tab: "payg",
        keywords: "payg pay as you go daily billing arrears",
      },
      {
        title: "Auto-extension",
        description: "Let rentals renew automatically each week or month, with the customer billed before every new period starts.",
        href: "/settings?tab=auto-extend",
        tab: "auto-extend",
        keywords: "auto extend auto-extend extension renew renewal recurring subscription",
      },
    ],
  },
  {
    title: "Notifications",
    items: [
      {
        title: "Team emails",
        description: "Choose which emails you and your team receive about new bookings, payments and other activity on your account.",
        href: "/settings?tab=reminders",
        tab: "reminders",
        keywords: "email notifications alerts reminders",
      },
      {
        title: "Push notifications",
        description: "Send instant alerts to your team's phones and browsers when something on your account needs attention.",
        href: "/settings?tab=push",
        tab: "push",
        keywords: "push mobile browser alerts",
      },
      {
        title: "Customer messages",
        description: "The return reminder, the emails customers receive, the lockbox code email and the rental agreement they sign.",
        href: "/settings?tab=templates",
        tab: "templates",
        keywords: "templates email agreement contract return reminder sms lockbox code instructions",
      },
    ],
  },
];

export function SettingsIndexV2({
  canView,
  tenantSlug,
  isHeadAdmin = false,
  notice,
  hiddenHrefs,
}: {
  canView: (tab: string) => boolean;
  tenantSlug: string | null | undefined;
  /** Head admins also see Team. */
  isHeadAdmin?: boolean;
  /** Shown under the title: why a `?tab=` link landed here instead of a page. */
  notice?: ReactNode;
  /**
   * Entries (by `href`) this workspace has nothing behind: Optional modules
   * when no module applies to it. An empty page is worse than no entry.
   */
  hiddenHrefs?: readonly string[];
}) {
  const [query, setQuery] = useState("");

  // The top bar's search field filters this page, the way Stripe's does.
  usePageSearch({
    placeholder: "Search settings",
    value: query,
    onChange: setQuery,
    tourAnchor: "settings-search",
  });

  // May this user open the entry at all (permission, head-admin-only, lean gate)?
  // `useIsLean` is a hook, so it is read here and CLOSED OVER by the
  // predicate rather than called inside it.
  const leanTenant = useIsLean();
  // A string, so a new array with the same entries each render is not a change.
  const hiddenKey = (hiddenHrefs ?? []).join("\n");
  const allowed = useCallback(
    (item: SettingsIndexItem) =>
      (item.anyOfTabs ?? [item.tab]).some(canView) &&
      (!item.headAdminOnly || isHeadAdmin) &&
      !isSettingsTabHiddenForLean(item.tab, leanTenant) &&
      !(hiddenKey ? hiddenKey.split("\n") : []).includes(item.href),
    [canView, isHeadAdmin, leanTenant, hiddenKey]
  );

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SETTINGS_INDEX_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          allowed(item) &&
          (q === "" ||
            `${item.title} ${item.description} ${item.keywords ?? ""}`.toLowerCase().includes(q))
      ),
    })).filter((section) => section.items.length > 0);
  }, [query, allowed]);

  // Entries this user may open at all, ignoring the search. Zero means a
  // manager holding the Settings parent grant but no settings.* grant: say so,
  // rather than "no match" for a search they never typed.
  const anyVisible = SETTINGS_INDEX_SECTIONS.some((section) => section.items.some(allowed));
  // A search for something that lives on another screen (Stripe, Twilio,
  // Bonzah, billing, team members) points there instead of dead-ending.
  const handoff = query.trim() ? findSettingsSearchHandoff(query) : null;

  // No mx-auto: the page starts where the top bar's search field starts. Both sit
  // 16px inside the inset (main p-4, header sm:px-4), so centring the column
  // pushed the title and every section off that line on wide screens.
  // Switch row alignment: at md+ <main>'s content starts at y=50 and the h1 is a
  // 32px line, so 26px of top padding centres it at 50 + 26 + 16 = 92, the
  // sidebar Portal / Website switch's row (md:pt-7 left it 2px low, at 94).
  return (
    <div className="w-full max-w-[1160px] space-y-9 pb-16 md:pt-[26px]" data-tour="settings-index">
      <h1 className={SETTINGS_PAGE_TITLE}>Settings</h1>

      {notice}

      {handoff && (
        <SettingsDependencyNotice
          title={`Looking for ${handoff.label}?`}
          body={`That is managed in ${handoff.where}, not on this page.`}
          action={{ label: `Open ${handoff.where}`, href: handoff.href }}
        />
      )}

      {!anyVisible ? (
        <SettingsEmptyState
          icon={Lock}
          headline="No settings have been shared with you"
          body="Ask a head admin to give you access to the settings you need. Everything else you can use is in the sidebar."
        />
      ) : sections.length === 0 ? (
        <div className="rounded-2xl bg-card">
          <SettingsNoMatch query={query} noun="settings" onClear={() => setQuery("")} />
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.title} aria-labelledby={`settings-${section.title}`}>
            <h2 id={`settings-${section.title}`} className={SETTINGS_SECTION_TITLE}>
              {section.title}
            </h2>
            <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour={item.tourAnchor}
                  className="group -mx-3 block rounded-xl px-3 py-2.5 transition-colors hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
                >
                  <span className="text-[15px] font-medium text-primary group-hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]">
                    {item.title}
                  </span>
                  <span className="mt-1 block max-w-[320px] text-[13px] leading-[1.45] text-muted-foreground">
                    {item.description}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <p className="border-t pt-6 text-[13px] text-muted-foreground">
        Payments, insurance, e-signatures and text messages are set up in{" "}
        <Link href="/integrations" className="font-medium text-primary hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]">
          Integrations
        </Link>
        .
      </p>
    </div>
  );
}
