"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * A breakdown TRAX measured, drawn.
 *
 * It renders nothing the backend did not already return: the bars are the
 * `groups` of a business-query result, which the client has already validated,
 * and the values are the strings the query layer formatted. Nothing here rounds,
 * recomputes or re-orders a figure — a chart that disagreed with the sentence
 * above it would be worse than no chart.
 *
 * Form: one measure across categories, so a horizontal bar chart — the labels are
 * customer and category names, which need the width. One group is a number, not a
 * chart, so the caller skips it.
 *
 * Colour: a single series, so a single hue carries no information and must not be
 * a rainbow. `--chart-2` (#6461ff) is the design system's own step and is the one
 * that passes contrast on BOTH the light (#fcfcfb) and dark (#1a1a19) surfaces —
 * checked with the palette validator, not by eye. Every bar is direct-labelled, so
 * the figures never depend on colour or on hovering.
 */
export interface AnswerGroup {
  key: string;
  label: string;
  value: string;
  currency?: string | null;
  rows?: number;
  outstanding?: string;
  credit?: string;
}

/** Beyond this the bubble stops being readable; the answer text still has the rest. */
const MAX_BARS = 8;
const SERIES = "hsl(var(--chart-2))";

const numeric = (value: string) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  // Number("") is 0, not NaN — an empty cell must not become a zero-length bar.
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Only a set that is actually comparable is worth drawing. */
export function chartable(groups: AnswerGroup[] | undefined): boolean {
  if (!Array.isArray(groups) || groups.length < 2) return false;
  const values = groups.map((group) => numeric(group.value));
  if (values.some((value) => value === null || value < 0)) return false;
  // Every bar at zero is a flat rule, not a comparison.
  if (values.every((value) => value === 0)) return false;
  // Mixed currencies are separate scales and must never share one axis.
  const currencies = new Set(groups.map((group) => group.currency ?? ""));
  return currencies.size === 1;
}

export function AnswerChart({ groups, caption }: { groups: AnswerGroup[]; caption?: string }) {
  const shown = groups.slice(0, MAX_BARS);
  const currency = shown[0]?.currency ?? null;
  const data = shown.map((group) => ({
    label: group.label || "—",
    value: numeric(group.value) ?? 0,
    display: currency ? `${currency} ${group.value}` : group.value,
  }));
  // Long names get the room they need, within reason.
  const axisWidth = Math.min(160, Math.max(64, ...data.map((row) => row.label.length * 6.5)));

  return (
    <figure className="mt-3 w-full">
      {caption && <figcaption className="mb-2 text-[11px] text-muted-foreground">{caption}</figcaption>}
      <ResponsiveContainer width="100%" height={Math.max(96, data.length * 30 + 16)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="label"
            width={axisWidth}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
            contentStyle={{
              fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))",
              background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
            }}
            formatter={(_v: unknown, _n: unknown, item: { payload?: { display?: string } }) => [item?.payload?.display ?? "", ""]}
          />
          {/* 4px rounded data-end, anchored to the baseline. */}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((row) => <Cell key={row.label} fill={SERIES} />)}
            <LabelList
              dataKey="display"
              position="right"
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {groups.length > shown.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Showing the {shown.length} largest of {groups.length}.
        </p>
      )}
    </figure>
  );
}
