"use client";

import { useState } from "react";
import type React from "react";
import { Check, Copy, Gift } from "lucide-react";
import { toast } from "sonner";
import { useTilt3D } from "@/hooks/use-tilt-3d";

/**
 * The operator's referral code, drawn as a gift card: the same 1.586 shape and
 * size as the payment card beside it on Billing (payment-card-3d.tsx). The
 * offer a new operator gets sits on the face; a perforation runs across the
 * card with a notch punched out of each edge; the code and Copy sit on the
 * tear-off strip below. Tilts and catches the light like the payment card.
 *
 * The notches are real cut-outs (a CSS mask), so the card looks right on any
 * background in both themes. A mask clips box-shadow, so the depth is a
 * `drop-shadow` on the tilting wrapper, which follows the masked shape.
 *
 * Everything on the face is sized in em off one font-size that is a share of
 * the card's own width (4cqw), so it scales as a whole, like the payment card.
 *
 * `fit`: on md+ size to the parent (a size container) like the payment card,
 * capped at 440×277. Without it the card is simply full width up to 440px.
 */

/** Where the perforation sits, as a share of the card's height. */
const PERF = 64;

/* Notch radius as % of the card: 4% of the width, and 4% × 1.586 of the
   height, so the ellipse is a true circle that scales with the card. (A cqw
   radius here would measure the parent's container, not this card.) */
const MASK = [
  `radial-gradient(ellipse 4% 6.35% at 0 ${PERF}%, transparent 98%, #000 100%)`,
  `radial-gradient(ellipse 4% 6.35% at 100% ${PERF}%, transparent 98%, #000 100%)`,
].join(", ");

export function ReferralCoupon3D({
  code,
  discountText,
  durationText,
  fit = false,
  onOpen,
  actionLabel,
}: {
  code: string | null;
  /** e.g. "20% off" — the new operator's discount. */
  discountText: string | null;
  /** e.g. "for your first 3 months". */
  durationText: string | null;
  fit?: boolean;
  /** Makes the whole coupon open something (the referrals dialog). Copy still copies. */
  onOpen?: () => void;
  /** A small frosted label top-right, e.g. "View details". Replaces "Drive247" there. */
  actionLabel?: string;
}) {
  const { ref, sheenRef, handlers } = useTilt3D();
  const [copied, setCopied] = useState(false);
  const empty = !code;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the code and copy it by hand.");
    }
  };

  return (
    // `data-skeleton-block`: under a loading <AutoSkeleton> the coupon is one
    // bone, not its printed face with bars over it. Inert otherwise.
    <div
      data-skeleton-block
      className={`w-full max-w-[440px] [perspective:1000px] ${onOpen ? "group cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2" : ""} ${
        fit ? "md:aspect-[1.586] md:h-[min(100cqh,63cqw,277px)] md:w-auto md:max-w-none" : ""
      }`}
      {...handlers}
      {...(onOpen
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": actionLabel ?? "Open referrals",
            onClick: onOpen,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            },
          }
        : {})}
    >
      <div
        ref={ref}
        className="h-full [transform-style:preserve-3d] motion-reduce:!transform-none motion-reduce:!transition-none"
        style={{
          filter:
            "drop-shadow(0 1px 1px rgba(15,23,42,0.16)) drop-shadow(0 10px 14px rgba(15,23,42,0.22)) drop-shadow(0 22px 28px rgba(79,70,229,0.18))",
        }}
      >
        <div
          className={`relative aspect-[1.586] w-full select-none overflow-hidden rounded-2xl text-white ${fit ? "md:h-full" : ""} ${
            empty ? "opacity-60 saturate-50" : ""
          }`}
          style={{
            background: "linear-gradient(135deg, #4338ca 0%, #6366f1 52%, #818cf8 100%)",
            containerType: "inline-size",
            WebkitMaskImage: MASK,
            maskImage: MASK,
            WebkitMaskComposite: "source-in",
            maskComposite: "intersect",
          }}
        >
          {/* Depth on the printed face, in % so it scales with the card. */}
          <div aria-hidden className="pointer-events-none absolute -right-[15%] -top-[35%] h-[90%] w-[57%] rounded-full bg-white/[0.08]" />
          <div aria-hidden className="pointer-events-none absolute -bottom-[45%] -left-[10%] h-[90%] w-[57%] rounded-full bg-black/[0.10]" />
          {/* The tear-off strip, a shade darker. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/[0.14]" style={{ top: `${PERF}%` }} />
          <div
            ref={sheenRef}
            aria-hidden
            className="pointer-events-none absolute -inset-1/2 opacity-0 motion-reduce:hidden"
            style={{ background: "radial-gradient(circle at center, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 45%)" }}
          />
          {/* Perforation, between the two notches. */}
          <div
            aria-hidden
            className="absolute border-t-2 border-dashed border-white/45"
            style={{ top: `${PERF}%`, left: "6%", right: "6%" }}
          />

          <div className="relative h-full" style={{ fontSize: "4cqw" }}>
            {/* ── face: what the new operator gets ─────────────────────── */}
            <div className="flex flex-col justify-between" style={{ height: `${PERF}%`, padding: "1.3em 1.5em 1em" }}>
              <div className="flex items-start justify-between">
                <span className="font-semibold uppercase leading-none opacity-80" style={{ fontSize: "0.7em", letterSpacing: "0.2em" }}>
                  Referral
                </span>
                {actionLabel ? (
                  <span
                    className="rounded-full border border-white/25 bg-white/10 font-medium leading-none text-white/90 backdrop-blur-sm transition-colors duration-200 ease-out group-hover:bg-white/20 motion-reduce:transition-none"
                    style={{ fontSize: "0.62em", padding: "0.5em 0.95em", letterSpacing: "0.04em" }}
                  >
                    {actionLabel}
                  </span>
                ) : (
                  <span className="font-semibold uppercase leading-none opacity-60" style={{ fontSize: "0.7em", letterSpacing: "0.2em" }}>
                    Drive247
                  </span>
                )}
              </div>
              <div>
                <p className="font-semibold uppercase leading-none opacity-75" style={{ fontSize: "0.62em", letterSpacing: "0.2em", marginBottom: "0.45em" }}>
                  They get
                </p>
                {discountText ? (
                  <div className="flex items-baseline" style={{ gap: "0.5em" }}>
                    <span className="whitespace-nowrap font-bold leading-none tracking-tight" style={{ fontSize: "2.1em" }}>
                      {discountText}
                    </span>
                    {durationText && (
                      <span className="truncate opacity-80" style={{ fontSize: "0.82em" }}>
                        {durationText}
                      </span>
                    )}
                  </div>
                ) : (
                  <Gift aria-hidden style={{ height: "2em", width: "2em" }} className="opacity-90" />
                )}
              </div>
            </div>

            {/* ── tear-off strip: the code ─────────────────────────────── */}
            <div
              className="flex items-center justify-between"
              style={{ height: `${100 - PERF}%`, padding: "0 1.5em", gap: "0.8em" }}
            >
              <div className="min-w-0">
                <p className="uppercase leading-none opacity-60" style={{ fontSize: "0.56em", letterSpacing: "0.18em", marginBottom: "0.5em" }}>
                  {empty ? "Your code appears once you subscribe" : "Your referral code"}
                </p>
                <p
                  className="truncate font-mono font-bold leading-none [text-shadow:0_1px_1px_rgba(0,0,0,0.3)]"
                  style={{ fontSize: "1.2em", letterSpacing: "0.1em" }}
                  title={code ?? undefined}
                >
                  {code ?? "••••-••••"}
                </p>
              </div>
              {!empty && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation(); // copy, don't open the dialog
                    void copy();
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Copy referral code"
                  className="inline-flex shrink-0 items-center rounded-full bg-white font-semibold text-indigo-700 transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
                  style={{ fontSize: "0.72em", padding: "0.45em 0.95em", gap: "0.4em" }}
                >
                  {copied ? <Check style={{ height: "1.1em", width: "1.1em" }} /> : <Copy style={{ height: "1.1em", width: "1.1em" }} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
