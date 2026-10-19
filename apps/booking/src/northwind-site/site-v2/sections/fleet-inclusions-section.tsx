import { Check } from "lucide-react-nw";

import { formatMoney } from "@nw/components/fleet/format";
import { resolveIcon } from "@nw/lib/cms/icons";
import { loadSection, resolveTenant } from "@nw/lib/cms/server";
import { CARD, ICON_TILE, Section, SectionHeading } from "@nw/site-v2/kit";
import { cn } from "@nw/lib/utils";

/**
 * v2 of `components/sections/fleet-inclusions-section.tsx`: "What's included"
 * and "Paid extras", from `fleet / inclusions` and `fleet / extras` — the same
 * reads and the same rule that the whole section is absent until written.
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

const named = (items: InclusionItem[]) => (items ?? []).filter((item) => (item.title ?? "").trim() !== "");

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
  const paid = (extras.items ?? []).filter((item) => (item.name ?? "").trim() !== "");

  if (standard.length === 0 && premium.length === 0 && paid.length === 0) {
    return null;
  }

  const heading = inclusions.section_title.trim() || "Every rental includes";
  const columns = [
    { title: inclusions.standard_title, items: standard },
    { title: inclusions.premium_title, items: premium },
  ].filter((column) => column.items.length > 0);

  return (
    <Section>
      {columns.length > 0 && (
        <>
          <SectionHeading
            title={heading}
            description={inclusions.section_subtitle.trim() || "What comes with every car, before any extras."}
          />
          <div className={cn("mt-5 grid grid-cols-1 gap-4", columns.length > 1 && "lg:grid-cols-2")}>
            {columns.map((column) => (
              <div key={column.title || column.items[0]?.title} className={cn(CARD, "px-5 py-5")}>
                {(column.title ?? "").trim() !== "" && (
                  <p className="text-[15px] font-semibold text-pv-fg">{column.title}</p>
                )}
                <ul className={cn("space-y-3", (column.title ?? "").trim() !== "" && "mt-4")}>
                  {column.items.map((item, index) => {
                    const Icon = resolveIcon(item.icon, Check);
                    return (
                      <li key={`${index}-${item.title}`} className="flex items-center gap-3">
                        <span className={ICON_TILE}>
                          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                        </span>
                        <span className="text-[14px] leading-relaxed text-pv-fg">{item.title}</span>
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
        <div className={columns.length > 0 ? "mt-10" : undefined}>
          <SectionHeading title="Optional extras" description="Add any of these when you book." />
          <ul className={cn(CARD, "mt-5 divide-y divide-pv-border overflow-hidden")}>
            {paid.map((item, index) => {
              const price = priceOf(item.price, tenant?.currency_code);
              return (
                <li key={`${index}-${item.name}`} className="flex items-start justify-between gap-6 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-pv-fg">{item.name}</p>
                    {(item.description ?? "").trim() !== "" && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">{item.description}</p>
                    )}
                  </div>
                  {price && <p className="shrink-0 text-[14px] font-semibold tabular-nums text-pv-fg">{price}</p>}
                </li>
              );
            })}
          </ul>
          {extras.footer_text.trim() !== "" && (
            <p className="mt-3 text-xs leading-relaxed text-pv-muted-fg">{extras.footer_text}</p>
          )}
        </div>
      )}
    </Section>
  );
}
