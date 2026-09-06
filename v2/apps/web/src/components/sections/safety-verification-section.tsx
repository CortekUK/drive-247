import { Droplet, Gauge } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { DEFAULT_SAFETY_VERIFICATION } from "@/lib/cms/defaults";
import { Editable, cmsImage, cmsSection } from "@/lib/cms/editable";
import { completeRows } from "@/lib/cms/merge";
import { loadSection } from "@/lib/cms/server";
import type { SafetyCardItem } from "@/lib/cms/types";

/**
 * The diagnostics band — `home / safety_verification`.
 *
 * Every word and the photograph in here were string literals until now: this
 * section had no CMS key at all, in either v1's editor or v2's, so an operator
 * looking at their own home page could change eight of the nine bands on it and
 * not this one. `DEFAULT_SAFETY_VERIFICATION` carries the exact copy that was
 * hardcoded, which is why binding it changed nothing on screen.
 *
 * What is NOT content, and stays keyed on position:
 *
 *   - which card shows an icon, and which icon;
 *   - which card draws a bar and in which colour;
 *   - which footnote is red and which is green;
 *   - which card renders its value as a big number.
 *
 * Those are the design's, the same way `how_it_works` picks its step icon by
 * position. An operator who reorders the cards moves their words, not the
 * palette — which is the behaviour that keeps a two-minute copy edit from
 * producing a green "Critical".
 */

/** Per-position presentation. Three slots, because the Figma band has three. */
type CardStyle = {
  icon?: React.ReactNode;
  barTone?: "critical" | "info";
  footnoteTone?: "critical" | "success";
  footnoteRightTone?: "critical" | "success";
  displayLarge?: boolean;
  tinyHelp?: boolean;
};

const CARD_STYLE: CardStyle[] = [
  {
    icon: <Droplet className="size-3.5 text-danger" strokeWidth={2} />,
    barTone: "critical",
    footnoteRightTone: "critical",
  },
  {
    footnoteTone: "success",
    displayLarge: true,
    tinyHelp: true,
  },
  {
    icon: <Gauge className="size-3.5 text-danger" strokeWidth={2} />,
    barTone: "info",
    footnoteRightTone: "success",
  },
];

export async function SafetyVerificationSection() {
  const content = await loadSection(
    "home",
    "safety_verification",
    DEFAULT_SAFETY_VERIFICATION,
  );
  // Laid over the shipped cards row by row: the first in-place edit to this
  // section writes ONE field of ONE card into a row that does not exist yet,
  // and without this the other two arrive as null. See `completeRows`.
  const cards = completeRows(content.cards, DEFAULT_SAFETY_VERIFICATION.cards).slice(0, 3);

  const card = (index: number) => {
    const item: SafetyCardItem | undefined = cards[index];
    if (!item) return null;
    const style = CARD_STYLE[Math.min(index, CARD_STYLE.length - 1)];
    return (
      <DiagnosticCard
        item={item}
        cmsPath={`home.safety_verification.cards.${index}`}
        {...style}
      />
    );
  };

  /*
    Each of the three cards is rendered TWICE — once in the stacked mobile
    layout, once in the overlaid desktop one — and only one of the two is ever
    visible. Both copies carry the same `data-cms` path, which is what makes
    that safe: an edit to either writes the same field, and the overlay's image
    handles skip whichever copy currently measures zero.
  */
  const engineOilCard = card(0);
  const tirePressureCard = card(1);
  const brakeLifeCard = card(2);

  return (
    <section
      {...cmsSection("home.safety_verification", "Safety checks")}
      className="bg-white"
    >
      <div className="container-page grid grid-cols-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16 lg:py-24">
        <div className="flex flex-col gap-6">
          <h2 className="font-sans text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            <Editable path="home.safety_verification.title">{content.title}</Editable>
          </h2>
          <p className="max-w-[440px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            <Editable path="home.safety_verification.description">
              {content.description}
            </Editable>
          </p>
          <Link
            href="/booking"
            className="inline-flex w-fit items-center justify-center rounded-full bg-brand-forest px-7 py-[13px] text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Editable path="home.safety_verification.cta_text">
              {content.cta_text}
            </Editable>
          </Link>
        </div>

        {/* Mobile/tablet stacked layout */}
        <div className="flex flex-col gap-4 lg:hidden">
          <div className="flex items-start gap-3">
            <div className="flex-1">{engineOilCard}</div>
            <div className="w-[140px] shrink-0">{tirePressureCard}</div>
          </div>
          <div className="relative -mx-4">
            <Image
              {...cmsImage("home.safety_verification.image", content.image)}
              src={content.image}
              alt={content.image_alt}
              width={2200}
              height={970}
              sizes="100vw"
              className="h-auto w-full object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.12)]"
              priority={false}
            />
          </div>
          <div>{brakeLifeCard}</div>
        </div>

        {/* Desktop overlay layout */}
        <div className="relative hidden lg:block lg:min-h-[480px]">
          <Image
            {...cmsImage("home.safety_verification.image", content.image)}
            src={content.image}
            alt={content.image_alt}
            width={2200}
            height={970}
            sizes="60vw"
            className="absolute inset-x-[-10%] inset-y-0 m-auto h-auto w-[120%] object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.12)]"
            priority={false}
          />
          <div className="absolute left-0 top-[8%] z-10 w-[260px]">
            {engineOilCard}
          </div>
          <div className="absolute right-0 top-[2%] z-10 w-[150px]">
            {tirePressureCard}
          </div>
          <div className="absolute right-0 bottom-[6%] z-10 w-[260px]">
            {brakeLifeCard}
          </div>
        </div>
      </div>
    </section>
  );
}

type DiagnosticCardProps = {
  item: SafetyCardItem;
  /** e.g. `home.safety_verification.cards.1`. */
  cmsPath: string;
  icon?: React.ReactNode;
  barTone?: "critical" | "info";
  footnoteTone?: "critical" | "success";
  footnoteRightTone?: "critical" | "success";
  displayLarge?: boolean;
  tinyHelp?: boolean;
};

function DiagnosticCard({
  item,
  cmsPath,
  icon,
  barTone,
  footnoteTone,
  footnoteRightTone,
  displayLarge,
  tinyHelp,
}: DiagnosticCardProps) {
  const showBar = barTone !== undefined;
  return (
    <div className="rounded-[10px] bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-brand-border-soft">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-text">
          {icon}
          <Editable path={`${cmsPath}.label`}>{item.label}</Editable>
          {tinyHelp && (
            <span
              aria-hidden
              className="ml-0.5 inline-flex size-3 items-center justify-center rounded-full text-[8px] text-brand-text-subtle ring-1 ring-brand-border-soft"
            >
              i
            </span>
          )}
        </span>
        {!displayLarge && (
          <span className="text-[12px] font-semibold text-brand-text">
            <Editable path={`${cmsPath}.value`}>{item.value}</Editable>
          </span>
        )}
      </div>
      {displayLarge && (
        <p className="mt-1 text-[22px] font-semibold leading-[26px] tracking-tight text-brand-text">
          <Editable path={`${cmsPath}.value`}>{item.value}</Editable>
        </p>
      )}
      {showBar && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${
              barTone === "critical" ? "bg-danger" : "bg-brand-progress-bar"
            }`}
            // Clamped rather than trusted: this is an operator-typed number and
            // an unbounded one would draw a bar out past the card's rounding.
            style={{ width: `${Math.max(0, Math.min(100, item.bar_value))}%` }}
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] font-medium">
        <span
          className={
            footnoteTone === "critical"
              ? "text-danger"
              : footnoteTone === "success"
                ? "text-success"
                : "text-brand-text-subtle"
          }
        >
          <Editable path={`${cmsPath}.footnote`}>{item.footnote}</Editable>
        </span>
        {(item.footnote_right ?? "").trim() !== "" && (
          <span
            className={
              footnoteRightTone === "critical"
                ? "text-danger"
                : "text-success"
            }
          >
            <Editable path={`${cmsPath}.footnote_right`}>
              {item.footnote_right}
            </Editable>
          </span>
        )}
      </div>
    </div>
  );
}
