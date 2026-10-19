import { ArrowRight, CircleGauge, Droplet, Gauge } from "lucide-react-nw";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@nw/components/ui/button";
import { DEFAULT_SAFETY_VERIFICATION } from "@nw/lib/cms/defaults";
import { Editable, cmsImage, cmsSection } from "@nw/lib/cms/editable";
import { completeRows } from "@nw/lib/cms/merge";
import { loadSection } from "@nw/lib/cms/server";
import type { SafetyCardItem } from "@nw/lib/cms/types";
import { cn } from "@nw/lib/utils";
import { CARD, ICON_TILE, SITE_CONTAINER } from "@nw/site-v2/kit";

/**
 * v2 of `components/sections/safety-verification-section.tsx` — same key
 * (`home / safety_verification`), same marks, and the same split: words are
 * the operator's, presentation (icon, bar, tone, big number) stays keyed on
 * POSITION so a reorder moves words, never the palette.
 *
 * v1 overlays three floating cards on the photo and renders each twice (one
 * copy per breakpoint). v2 sets the photo in a calm card with the three
 * readings in a row beneath it, so every card renders once.
 */

type CardStyle = {
  icon: typeof Droplet;
  barTone?: "critical" | "info";
  footnoteTone?: "critical" | "success";
  footnoteRightTone?: "critical" | "success";
  displayLarge?: boolean;
};

const CARD_STYLE: CardStyle[] = [
  { icon: Droplet, barTone: "critical", footnoteRightTone: "critical" },
  { icon: CircleGauge, footnoteTone: "success", displayLarge: true },
  { icon: Gauge, barTone: "info", footnoteRightTone: "success" },
];

const TONE = { critical: "text-pv-danger", success: "text-pv-success" } as const;

export async function SafetyVerificationSection() {
  const content = await loadSection("home", "safety_verification", DEFAULT_SAFETY_VERIFICATION);
  const cards = completeRows(content.cards, DEFAULT_SAFETY_VERIFICATION.cards).slice(0, 3);

  return (
    <section
      {...cmsSection("home.safety_verification", "Safety checks")}
      className={`${SITE_CONTAINER} grid items-center gap-8 pt-12 md:pt-16 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-12`}
    >
      <div className="min-w-0">
        <h2 className="text-[24px] font-bold leading-[1.15] tracking-[-0.03em] text-pv-fg md:text-[28px]">
          <Editable path="home.safety_verification.title">{content.title}</Editable>
        </h2>
        <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-pv-muted-fg">
          <Editable path="home.safety_verification.description">{content.description}</Editable>
        </p>
        <Button asChild variant="brand" className="mt-6 h-11 px-5">
          <Link href="/booking">
            <Editable path="home.safety_verification.cta_text">{content.cta_text}</Editable>
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>

      <div className={cn(CARD, "p-3 md:p-4")}>
        <div className="rounded-xl bg-pv-muted px-4 py-6 md:py-8">
          <Image
            {...cmsImage("home.safety_verification.image", content.image)}
            src={content.image}
            alt={content.image_alt}
            width={2200}
            height={970}
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="mx-auto h-auto w-full max-w-[640px] object-contain"
          />
        </div>
        <div className={cn("mt-3 grid gap-3", cards.length === 3 ? "sm:grid-cols-3" : cards.length === 2 ? "sm:grid-cols-2" : "")}>
          {cards.map((item, index) => (
            <DiagnosticCard
              key={index}
              item={item}
              cmsPath={`home.safety_verification.cards.${index}`}
              {...CARD_STYLE[Math.min(index, CARD_STYLE.length - 1)]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function DiagnosticCard({
  item,
  cmsPath,
  icon: Icon,
  barTone,
  footnoteTone,
  footnoteRightTone,
  displayLarge,
}: CardStyle & { item: SafetyCardItem; cmsPath: string }) {
  return (
    <div className="rounded-xl border border-pv-border bg-pv-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-pv-fg">
          <span className={cn(ICON_TILE, "size-6 rounded-md")}>
            <Icon aria-hidden className="size-3.5" strokeWidth={2} />
          </span>
          <Editable path={`${cmsPath}.label`}>{item.label}</Editable>
        </span>
        {!displayLarge && (
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-pv-fg">
            <Editable path={`${cmsPath}.value`}>{item.value}</Editable>
          </span>
        )}
      </div>
      {displayLarge && (
        <p className="mt-2 text-[22px] font-bold leading-none tracking-[-0.02em] text-pv-fg">
          <Editable path={`${cmsPath}.value`}>{item.value}</Editable>
        </p>
      )}
      {barTone && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-pv-muted">
          <div
            className={cn("h-full rounded-full", barTone === "critical" ? "bg-pv-danger" : "bg-pv-primary")}
            // Clamped: an operator-typed number must not draw past the track.
            style={{ width: `${Math.max(0, Math.min(100, item.bar_value))}%` }}
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-medium">
        <span className={footnoteTone ? TONE[footnoteTone] : "text-pv-muted-fg"}>
          <Editable path={`${cmsPath}.footnote`}>{item.footnote}</Editable>
        </span>
        {(item.footnote_right ?? "").trim() !== "" && (
          <span className={TONE[footnoteRightTone ?? "success"]}>
            <Editable path={`${cmsPath}.footnote_right`}>{item.footnote_right}</Editable>
          </span>
        )}
      </div>
    </div>
  );
}
