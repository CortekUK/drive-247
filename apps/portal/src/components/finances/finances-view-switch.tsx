"use client";

/**
 * The view switch: Billed · Received · Upcoming · Fines.
 *
 * Drawn as the v2 in-page tab strip (`SETTINGS_TAB_LIST` / `SETTINGS_TAB_TRIGGER`
 * from settings-kit: brand-tinted pills, no track, wrapping on a narrow phone
 * rather than scrolling and clipping a focus ring) — the one tab strip v2
 * already uses to split a page. None of the Rentals, Customers or Vehicles
 * lists has a view switch of its own to copy.
 *
 * The filters are not here: status, method and period live in the filter
 * panel on the back of the overview, and the search in the top bar, as on
 * every other v2 list.
 */

import { Tabs, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { SETTINGS_TAB_LIST, SETTINGS_TAB_TRIGGER } from "@/components/settings-v2/settings-kit";
import type { FinanceView } from "@/lib/finances/types";
import { VIEW_LABEL } from "./finance-words";

export function FinancesViewSwitch({
  views,
  view,
  onView,
}: {
  /** The views this user may see, in order. One view needs no switch. */
  views: FinanceView[];
  view: FinanceView;
  onView: (view: FinanceView) => void;
}) {
  if (views.length < 2) return null;
  return (
    <Tabs value={view} onValueChange={(v) => onView(v as FinanceView)} data-finances-toolbar="" data-tour="finances-views">
      <TabsList aria-label="Finances views" className={SETTINGS_TAB_LIST}>
        {views.map((v) => (
          <TabsTrigger key={v} value={v} data-finance-view={v} className={SETTINGS_TAB_TRIGGER}>
            {VIEW_LABEL[v]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
