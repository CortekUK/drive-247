import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { formatMoney } from "@nw/components/fleet/format";
import { DEFAULT_STATS } from "@nw/lib/cms/defaults";
import { getTenantSlug, loadSection } from "@nw/lib/cms/server";

/**
 * The operator's numbers, as the home page's "Why rent" strip and the About
 * page's picture show them. Two are real, read from the fleet: how many cars
 * there are and the lowest daily price. Two are the operator's own, from their
 * `about / stats` CMS rows: the average rating and years on the road — shown
 * only when the operator wrote them. "Rentals completed" is not used: a small
 * number there reads as a warning, not a boast.
 */

export type SiteNumber = {
  key: "cars" | "from" | "rating" | "years";
  to: number;
  decimals: number;
  prefix: string;
  suffix: string;
  label: string;
};

/** "4.8" + "/5" → a number to count to, and what goes around it. */
function fromCms(key: SiteNumber["key"], value: string, suffix: string, label: string): SiteNumber | null {
  const match = value.trim().match(/^([^\d]*)(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, before, digits, after] = match;
  return {
    key,
    to: Number(digits),
    decimals: digits.includes(".") ? digits.split(".")[1].length : 0,
    prefix: before,
    suffix: `${after}${suffix ?? ""}`,
    label,
  };
}

/** "$45" → prefix "$", 45, suffix "" — so the currency stays put while the number counts. */
function fromMoney(amount: number, currencyCode: string | null): Pick<SiteNumber, "to" | "prefix" | "suffix"> {
  const text = formatMoney(amount, currencyCode);
  const first = text.search(/\d/);
  const last = text.length - [...text].reverse().join("").search(/\d/);
  return { to: amount, prefix: text.slice(0, first), suffix: text.slice(last) };
}

/** The numbers, in the order cars → lowest price → rating → years; any without data are left out. */
export async function loadSiteNumbers(): Promise<SiteNumber[]> {
  const slug = await getTenantSlug();
  const [seed, stats] = await Promise.all([loadFleetSeed(slug), loadSection("about", "stats", DEFAULT_STATS)]);

  const cars = seed?.vehicles ?? [];
  const rates = cars.map((v) => v.dailyRent).filter((r): r is number => r != null && r > 0);
  const rows = stats.items ?? [];
  const cms = (key: SiteNumber["key"], pattern: RegExp) => {
    const row = rows.find((item) => pattern.test(item.label ?? "") && item.value?.trim());
    return row ? fromCms(key, row.value, row.suffix, row.label) : null;
  };

  return [
    ...(cars.length > 0
      ? [{ key: "cars" as const, to: cars.length, decimals: 0, prefix: "", suffix: "", label: "Cars to choose from" }]
      : []),
    ...(rates.length > 0
      ? [{ key: "from" as const, ...fromMoney(Math.min(...rates), seed?.currencyCode ?? null), decimals: 0, label: "A day, our lowest price" }]
      : []),
    ...[cms("rating", /rating/i), cms("years", /year/i)].filter((stat): stat is SiteNumber => stat !== null),
  ];
}
