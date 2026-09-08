import { Check } from "lucide-react";

import { resolveIcon } from "@/lib/cms/icons";
import { loadSection } from "@/lib/cms/server";

/**
 * "What's included" and "Paid extras", from `fleet / inclusions` and
 * `fleet / extras`.
 *
 * Both sections have existed in the portal since the CMS was built and NEITHER
 * was read by this site — an operator could list what every rental includes,
 * price up their child seats and additional drivers, publish, and the fleet
 * page showed none of it.
 *
 * Everything here is absent until written. These are not part of the shipped
 * Figma design, so a tenant who has filled in nothing gets exactly the page
 * they have today, and the first inclusion they add is the first thing that
 * appears.
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

const named = (items: InclusionItem[]) =>
  (items ?? []).filter((item) => (item.title ?? "").trim() !== "");

/** A price the operator typed, or null when they left it blank. */
function money(value: ExtraItem["price"]): string | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export async function FleetInclusionsSection() {
  const [inclusions, extras] = await Promise.all([
    loadSection("fleet", "inclusions", EMPTY_INCLUSIONS),
    loadSection("fleet", "extras", EMPTY_EXTRAS),
  ]);

  const standard = named(inclusions.standard_items);
  const premium = named(inclusions.premium_items);
  const paid = (extras.items ?? []).filter(
    (item) => (item.name ?? "").trim() !== "",
  );

  if (standard.length === 0 && premium.length === 0 && paid.length === 0) {
    return null;
  }

  const heading = inclusions.section_title.trim() || "Every rental includes";

  return (
    <section className="bg-brand-cream">
      <div className="container-page py-12 lg:py-20">
        {(standard.length > 0 || premium.length > 0) && (
          <>
            <header className="max-w-2xl">
              <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
                {heading}
              </h2>
              {inclusions.section_subtitle.trim() !== "" && (
                <p className="mt-3 text-sm leading-relaxed text-brand-text-soft sm:text-base">
                  {inclusions.section_subtitle}
                </p>
              )}
            </header>

            <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
              {[
                { title: inclusions.standard_title, items: standard },
                { title: inclusions.premium_title, items: premium },
              ]
                .filter((column) => column.items.length > 0)
                .map((column) => (
                  <div key={column.title || column.items[0]?.title}>
                    {(column.title ?? "").trim() !== "" && (
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-text-soft">
                        {column.title}
                      </h3>
                    )}
                    <ul className="mt-4 space-y-3">
                      {column.items.map((item, index) => {
                        const Icon = resolveIcon(item.icon, Check);
                        return (
                          <li
                            key={`${index}-${item.title}`}
                            className="flex items-start gap-3"
                          >
                            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber text-brand-text">
                              <Icon className="size-3.5" strokeWidth={2} />
                            </span>
                            <span className="text-sm leading-relaxed text-brand-text sm:text-base">
                              {item.title}
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
          <div className="mt-12">
            <h3 className="text-xl font-semibold tracking-tight text-brand-text">
              Optional extras
            </h3>
            <ul className="mt-5 divide-y divide-brand-border-soft overflow-hidden rounded-2xl bg-white ring-1 ring-brand-border-soft">
              {paid.map((item, index) => {
                const price = money(item.price);
                return (
                  <li
                    key={`${index}-${item.name}`}
                    className="flex items-start justify-between gap-6 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-text sm:text-base">
                        {item.name}
                      </p>
                      {(item.description ?? "").trim() !== "" && (
                        <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
                          {item.description}
                        </p>
                      )}
                    </div>
                    {/* A blank price is left blank rather than shown as $0 —
                        "free" and "not priced yet" are different claims. */}
                    {price && (
                      <p className="shrink-0 text-sm font-semibold text-brand-text sm:text-base">
                        {price}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {extras.footer_text.trim() !== "" && (
              <p className="mt-3 text-xs leading-relaxed text-brand-text-soft">
                {extras.footer_text}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
