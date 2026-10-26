import { Check } from "lucide-react-nw";

import { formatMoney } from "@nw/components/fleet/format";
import { resolveIcon } from "@nw/lib/cms/icons";
import { loadSection, resolveTenant } from "@nw/lib/cms/server";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { CARD, SITE_WIDE, SiteHeading } from "@nw/site-v2/kit";
import { cn } from "@nw/lib/utils";

/**
 * v2 of `components/sections/fleet-inclusions-section.tsx`: "What's included"
 * and "Paid extras", from `fleet / inclusions` and `fleet / extras` — the same
 * reads and the same rule that the whole section is absent until written.
 * Set in the home page's style: the always-included list as the big card, the
 * longer-rental extras as the tinted one beside it, then the extras you can
 * add, each with its price. Every word is editable in place.
 *
 * One deliberate difference: extras are priced with the shared `formatMoney`
 * in the tenant's own currency. v1 formats in a hardcoded USD.
 */

interface InclusionItem {
  icon?: string;
  title?: string;
}

interface ExtraItem {
  name?: string;
  price?: number | string | null;
  description?: string;
}

const EMPTY_INCLUSIONS = {
  section_title: "",
  section_subtitle: "",
  standard_title: "",
  standard_items: [] as InclusionItem[],
  premium_title: "",
  premium_items: [] as InclusionItem[],
};

const EMPTY_EXTRAS = {
  items: [] as ExtraItem[],
  footer_text: "",
};

/** The written rows, each with its STORED index: the editor writes back by position. */
const named = (items: InclusionItem[]) =>
  (items ?? []).map((item, index) => ({ ...item, index })).filter((item) => (item.title ?? "").trim() !== "");

/** A price the operator typed, or null when they left it blank ("free" and "not priced yet" differ). */
function priceOf(value: ExtraItem["price"], currencyCode: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return formatMoney(amount, currencyCode);
}

export async function FleetInclusionsSection() {
  const [inclusions, extras, tenant] = await Promise.all([
    loadSection("fleet", "inclusions", EMPTY_INCLUSIONS),
    loadSection("fleet", "extras", EMPTY_EXTRAS),
    resolveTenant(),
  ]);

  const standard = named(inclusions.standard_items);
  const premium = named(inclusions.premium_items);
  const paid = (extras.items ?? [])
    .map((item, index) => ({ ...item, index }))
    .filter((item) => (item.name ?? "").trim() !== "");

  if (standard.length === 0 && premium.length === 0 && paid.length === 0) {
    return null;
  }

  const heading = inclusions.section_title.trim() || "Every rental includes";
  const columns = [
    { key: "standard", title: inclusions.standard_title, items: standard },
    { key: "premium", title: inclusions.premium_title, items: premium },
  ].filter((column) => column.items.length > 0);

  return (
    <section {...cmsSection("fleet.inclusions", "What's included")} className={cn(SITE_WIDE, "pt-20 md:pt-28")}>
      {columns.length > 0 && (
        <>
          <SiteHeading
            title={<Editable path="fleet.inclusions.section_title">{heading}</Editable>}
            description={inclusions.section_subtitle.trim() || "What comes with every car, at no extra cost."}
          />
          <div data-reveal-group className={cn("mt-10 grid grid-cols-1 gap-4 lg:gap-5", columns.length > 1 && "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
            {columns.map((column, columnIndex) => (
              <div
                key={column.key}
                className={cn(CARD, "p-6 sm:p-8", columnIndex === 1 && "bg-pv-tint/60 border-transparent")}
              >
                {(column.title ?? "").trim() !== "" && (
                  <p className="text-[19px] font-bold tracking-[-0.02em] text-pv-fg md:text-[21px]">
                    <Editable path={`fleet.inclusions.${column.key}_title`}>{column.title}</Editable>
                  </p>
                )}
                <ul
                  className={cn(
                    "grid gap-x-8 gap-y-4",
                    columnIndex === 0 && column.items.length > 3 && "sm:grid-cols-2",
                    (column.title ?? "").trim() !== "" && "mt-6",
                  )}
                >
                  {column.items.map((item, index) => {
                    const Icon = resolveIcon(item.icon, Check);
                    return (
                      <li key={`${index}-${item.title}`} className="flex items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-pv-card text-pv-primary ring-1 ring-pv-border">
                          <Icon aria-hidden className="size-[18px]" strokeWidth={1.9} />
                        </span>
                        <span className="text-[15px] font-medium leading-snug text-pv-fg">
                          <Editable path={`fleet.inclusions.${column.key}_items.${item.index}.title`}>{item.title}</Editable>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      {paid.length > 0 && (
        <div className={columns.length > 0 ? "mt-16 md:mt-20" : undefined}>
          <SiteHeading
            align="left"
            title="Add to your rental"
            description="Choose any of these when you book. They are added to your total before you pay."
          />
          <ul data-reveal-group className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {paid.map((item, index) => {
              const price = priceOf(item.price, tenant?.currency_code);
              return (
                <li key={`${index}-${item.name}`} className={cn(CARD, "flex items-start justify-between gap-6 p-5")}>
                  <div className="min-w-0">
                    <p className="text-[16px] font-bold tracking-[-0.01em] text-pv-fg">
                      <Editable path={`fleet.extras.items.${item.index}.name`}>{item.name}</Editable>
                    </p>
                    {(item.description ?? "").trim() !== "" && (
                      <p className="mt-1 text-[14px] leading-relaxed text-pv-muted-fg">
                        <Editable path={`fleet.extras.items.${item.index}.description`}>{item.description}</Editable>
                      </p>
                    )}
                  </div>
                  {price && (
                    <p className="shrink-0 rounded-full bg-pv-tint px-3 py-1 text-[14px] font-bold tabular-nums text-pv-fg">
                      + {price}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {extras.footer_text.trim() !== "" && (
            <p className="mt-4 text-[13px] leading-relaxed text-pv-muted-fg">
              <Editable path="fleet.extras.footer_text">{extras.footer_text}</Editable>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
