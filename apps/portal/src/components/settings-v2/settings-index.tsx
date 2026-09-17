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
 */

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import {
  SettingsDependencyNotice,
  SettingsEmptyState,
  SettingsNoMatch,
} from "@/components/settings-v2/section-states";
import { findSettingsSearchHandoff } from "@/components/settings-v2/settings-shell-state";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { isSettingsTabHidden } from "@/lib/lean-areas";

export interface SettingsIndexItem {
  title: string;
  description: string;
  href: string;
  /** The v1 settings tab whose permission and lean gate this entry follows. */
  tab: string;
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
        description: "Choose the currency and distance unit used across prices, invoices and mileage, and turn optional modules on or off.",
        href: "/settings?tab=general",
        tab: "general",
        keywords: "currency distance miles kilometres km modules turo",
      },
      {
        title: "Branding",
        description: "Your business name, logo, favicon and brand colour, shown in this portal and on your customer booking site.",
        href: "/settings/appearance",
        tab: "branding",
        keywords: "logo colour color theme appearance name favicon",
        tourAnchor: "settings-tab-branding",
      },
      {
        title: "Locations",
        description: "Where customers pick up and return cars, the areas you deliver to, and what you charge for delivery.",
        href: "/settings?tab=locations",
        tab: "locations",
        keywords: "pickup return delivery address collection",
      },
    ],
  },
  {
    title: "Bookings",
    items: [
      {
        title: "Driver requirements",
        description: "Set the minimum driver age, choose the ID document customers must verify, and decide if staff can skip the check.",
        href: "/settings?tab=requirements",
        tab: "requirements",
        keywords: "age licence license passport id verification waiver",
      },
      {
        title: "Booking rules",
        description: "How far ahead customers must book, the shortest and longest rental allowed, and the gap you need between rentals.",
        href: "/settings?tab=duration",
        tab: "duration",
        keywords: "notice lead time duration minimum maximum buffer cooldown",
      },
      {
        title: "Key handover",
        description: "Let customers collect keys from a lockbox, and choose how and when the lockbox code is sent to them.",
        href: "/settings?tab=lockbox",
        tab: "lockbox",
        keywords: "lockbox keys code delivery",
      },
      {
        title: "Booking site",
        description: "Choose what customers see when they book online: prices, number plates, the gig driver option and your header colour.",
        href: "/settings?tab=booking-site",
        tab: "general",
        keywords: "gig driver price breakdown average daily plate vin registration header footer colour",
      },
      {
        title: "Global blacklist",
        description: "See the customers who have been blocked by three or more rental companies and cannot book with you.",
        href: "/settings/blacklist",
        tab: "blacklist",
        keywords: "blocked banned blacklist",
      },
    ],
  },
  {
    title: "Pricing and payments",
    items: [
      {
        title: "Pricing rules",
        description: "Add surcharges for weekends and holidays, and choose the rental length at which your monthly rate starts.",
        href: "/settings?tab=pricing",
        tab: "pricing",
        keywords: "weekend holiday surcharge dynamic monthly tier rate",
      },
      {
        title: "Tax and fees",
        description: "Add sales tax to your bookings and charge a service fee, either as a percentage of the rental or a fixed amount.",
        href: "/settings?tab=fees",
        tab: "fees",
        keywords: "tax vat service fee",
      },
      {
        title: "Security deposit",
        description: "Set the deposit taken on online bookings, and choose whether it is held on the customer's card or charged.",
        href: "/settings?tab=preauth",
        tab: "preauth",
        keywords: "deposit hold pre-authorisation preauth charge",
      },
      {
        title: "Installments",
        description: "Let customers split the cost of a longer rental into weekly or monthly payments instead of paying it all at once.",
        href: "/settings?tab=installments",
        tab: "installments",
        keywords: "installment instalment split payment plan",
      },
      {
        title: "Pay as you go",
        description: "Bill long rentals day by day while the car is out, instead of asking the customer to pay everything upfront.",
        href: "/settings?tab=payg",
        tab: "payg",
        keywords: "payg daily billing arrears",
      },
      {
        title: "Auto-extension",
        description: "Let rentals renew automatically each week or month, with the customer billed before every new period starts.",
        href: "/settings?tab=auto-extend",
        tab: "auto-extend",
        keywords: "auto extend renew recurring subscription",
      },
      {
        title: "Promo codes",
        description: "Create discount codes customers enter at checkout, or discounts that apply by themselves on longer rentals.",
        href: "/settings?tab=promos",
        tab: "promos",
        keywords: "promo discount coupon code",
      },
      {
        title: "Extras",
        description: "Add-ons customers can buy with a rental, such as child seats or GPS, and the price of each one.",
        href: "/settings?tab=extras",
        tab: "extras",
        keywords: "extras add-ons addons child seat gps",
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
        description: "Reminders sent before a car is due back, the emails your customers receive, and the rental agreement they sign.",
        href: "/settings?tab=templates",
        tab: "templates",
        keywords: "templates email agreement contract return reminder sms",
      },
    ],
  },
];

export function SettingsIndexV2({
  canView,
  tenantSlug,
  notice,
}: {
  canView: (tab: string) => boolean;
  tenantSlug: string | null | undefined;
  /** Shown under the title: why a `?tab=` link landed here instead of a page. */
  notice?: ReactNode;
}) {
  const [query, setQuery] = useState("");

  // The top bar's search field filters this page, the way Stripe's does.
  usePageSearch({
    placeholder: "Search settings",
    value: query,
    onChange: setQuery,
    tourAnchor: "settings-search",
  });

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SETTINGS_INDEX_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          canView(item.tab) &&
          !isSettingsTabHidden(item.tab, tenantSlug) &&
          (q === "" ||
            `${item.title} ${item.description} ${item.keywords ?? ""}`.toLowerCase().includes(q))
      ),
    })).filter((section) => section.items.length > 0);
  }, [query, canView, tenantSlug]);

  // Entries this user may open at all, ignoring the search. Zero means a
  // manager holding the Settings parent grant but no settings.* grant: say so,
  // rather than "no match" for a search they never typed.
  const anyVisible = SETTINGS_INDEX_SECTIONS.some((section) =>
    section.items.some((entry) => canView(entry.tab) && !isSettingsTabHidden(entry.tab, tenantSlug))
  );
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
      <h1 className="text-2xl font-medium tracking-tight text-foreground">Settings</h1>

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
            <h2
              id={`settings-${section.title}`}
              className="text-base font-semibold text-foreground"
            >
              {section.title}
            </h2>
            <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour={item.tourAnchor}
                  className="group -mx-3 block rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
                >
                  <span className="text-[15px] font-medium text-primary group-hover:underline dark:text-indigo-300">
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
        <Link href="/integrations" className="font-medium text-primary hover:underline dark:text-indigo-300">
          Integrations
        </Link>
        .
      </p>
    </div>
  );
}
