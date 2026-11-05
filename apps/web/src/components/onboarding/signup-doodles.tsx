"use client";

/**
 * The page behind the signup card: a faint dot grid with words scribbled
 * across the margins in a rough hand — the day-to-day of running a rental
 * business, the things Drive247 takes off the operator's plate — like a
 * sketchbook page the form was laid on. Different sizes, each turned a little,
 * a few in the accent. Nothing here is information; it is texture, so it stays
 * quiet enough that the eye never leaves the card.
 *
 * Kept out of the middle column (the card lives there) and off screens too
 * narrow to hold the margins.
 */

import { Caveat } from "next/font/google";

import { cn } from "@/lib/utils";

const hand = Caveat({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

type Word = {
  text: string;
  /** Centre of the text, in percent of the screen. */
  x: string;
  y: string;
  size: number;
  rotate: number;
  tone?: "accent";
  bold?: boolean;
};

/**
 * Every centre sits below 24% or above 76% of the width, so even the longest
 * phrase stays clear of the card on the narrowest screen that shows them.
 */
const WORDS: Word[] = [
  // left
  { text: "bookings while you sleep", x: "12%", y: "8%", size: 26, rotate: -4 },
  { text: "deposits", x: "4%", y: "16%", size: 22, rotate: 6, tone: "accent", bold: true },
  { text: "your own booking site", x: "16%", y: "22%", size: 32, rotate: -3, bold: true },
  { text: "e-sign", x: "6%", y: "30%", size: 24, rotate: 8 },
  { text: "ID checks", x: "20%", y: "33%", size: 21, rotate: -6, tone: "accent" },
  { text: "no more spreadsheets", x: "10%", y: "41%", size: 28, rotate: 2 },
  { text: "$/day", x: "22%", y: "48%", size: 24, rotate: -8, bold: true },
  { text: "keys out", x: "5%", y: "51%", size: 22, rotate: -2 },
  { text: "renters pay on their phone", x: "13%", y: "59%", size: 25, rotate: -5, tone: "accent" },
  { text: "extensions", x: "21%", y: "67%", size: 21, rotate: 7 },
  { text: "insurance", x: "5%", y: "70%", size: 23, rotate: -7 },
  { text: "returns on time", x: "13%", y: "78%", size: 30, rotate: 3, bold: true },
  { text: "fleet", x: "3%", y: "86%", size: 26, rotate: -10, tone: "accent" },
  { text: "get paid", x: "19%", y: "90%", size: 27, rotate: -3, bold: true },
  // right
  { text: "Trax has it handled", x: "88%", y: "8%", size: 28, rotate: 4, tone: "accent", bold: true },
  { text: "lockbox", x: "80%", y: "15%", size: 23, rotate: -6 },
  { text: "invoices", x: "95%", y: "18%", size: 21, rotate: 9 },
  { text: "one dashboard", x: "86%", y: "25%", size: 32, rotate: -2, bold: true },
  { text: "reminders", x: "79%", y: "33%", size: 22, rotate: 5, tone: "accent" },
  { text: "pick-up & drop-off", x: "91%", y: "38%", size: 25, rotate: -4 },
  { text: "fines", x: "80%", y: "46%", size: 24, rotate: 8, bold: true },
  { text: "messages in one place", x: "89%", y: "51%", size: 25, rotate: 3 },
  { text: "availability", x: "81%", y: "60%", size: 22, rotate: -7, tone: "accent" },
  { text: "repeat renters", x: "93%", y: "64%", size: 23, rotate: 6 },
  { text: "your customers, not the marketplace's", x: "87%", y: "73%", size: 24, rotate: -3, bold: true },
  { text: "payouts", x: "79%", y: "82%", size: 25, rotate: 4, tone: "accent" },
  { text: "5-star trips", x: "93%", y: "86%", size: 26, rotate: -6 },
  { text: "go live", x: "84%", y: "92%", size: 30, rotate: 2, bold: true },
];

/**
 * A second, closer ring that hugs the card, placed from the card's own edges
 * (it is 480px wide and centred) rather than from the screen's, so the space
 * right beside the card is never bare however wide the screen is. `gap` is
 * the distance from the card's edge to the near end of the text; `dy` is from
 * the middle of the screen, where the card is centred.
 */
type NearWord = { text: string; side: "left" | "right"; gap: number; dy: number; size: number; rotate: number; tone?: "accent"; bold?: boolean };

const HALF_CARD = 240;

const NEAR: NearWord[] = [
  // left of the card
  { text: "weekend rates", side: "left", gap: 36, dy: -250, size: 22, rotate: -5, tone: "accent" },
  { text: "card on file", side: "left", gap: 70, dy: -150, size: 20, rotate: 4 },
  { text: "agreements", side: "left", gap: 28, dy: -40, size: 24, rotate: -3, bold: true },
  { text: "check-in", side: "left", gap: 90, dy: 70, size: 21, rotate: 6, tone: "accent" },
  { text: "damage photos", side: "left", gap: 34, dy: 170, size: 22, rotate: -6 },
  { text: "blocked dates", side: "left", gap: 60, dy: 270, size: 20, rotate: 3, bold: true },
  // right of the card
  { text: "booking confirmed", side: "right", gap: 30, dy: -270, size: 22, rotate: 4, bold: true },
  { text: "delivery", side: "right", gap: 80, dy: -170, size: 21, rotate: -6, tone: "accent" },
  { text: "late returns", side: "right", gap: 36, dy: -60, size: 23, rotate: 3 },
  { text: "quotes", side: "right", gap: 96, dy: 40, size: 22, rotate: -4, bold: true },
  { text: "renter verified", side: "right", gap: 30, dy: 150, size: 21, rotate: 5, tone: "accent" },
  { text: "keys handed over", side: "right", gap: 64, dy: 255, size: 22, rotate: -3 },
];

export function SignupDoodles() {
  return (
    <div aria-hidden className={cn(hand.className, "pointer-events-none absolute inset-0 hidden overflow-hidden select-none xl:block")}>
      {/* the dot grid, fading out towards the bottom */}
      <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(30,27,75,0.13)_1px,transparent_1.3px)] bg-[size:22px_22px] [mask-image:linear-gradient(to_bottom,black_40%,transparent)] dark:bg-[radial-gradient(circle,rgba(199,210,254,0.10)_1px,transparent_1.3px)]" />
      {WORDS.map((w, i) => (
        <span
          key={i}
          className={cn(
            "absolute leading-none whitespace-nowrap",
            w.bold ? "font-bold" : "font-medium",
            w.tone === "accent"
              ? "text-indigo-500/40 dark:text-indigo-300/30"
              : "text-zinc-500/40 dark:text-zinc-400/30",
          )}
          style={{
            left: w.x,
            top: w.y,
            fontSize: w.size,
            transform: `translate(-50%, -50%) rotate(${w.rotate}deg)`,
          }}
        >
          {w.text}
        </span>
      ))}
      {NEAR.map((w, i) => (
        <span
          key={`near-${i}`}
          className={cn(
            "absolute leading-none whitespace-nowrap",
            w.bold ? "font-bold" : "font-medium",
            w.tone === "accent"
              ? "text-indigo-500/40 dark:text-indigo-300/30"
              : "text-zinc-500/40 dark:text-zinc-400/30",
          )}
          style={{
            top: `calc(50% + ${w.dy}px)`,
            ...(w.side === "left"
              ? { right: `calc(50% + ${HALF_CARD + w.gap}px)` }
              : { left: `calc(50% + ${HALF_CARD + w.gap}px)` }),
            fontSize: w.size,
            transform: `translateY(-50%) rotate(${w.rotate}deg)`,
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
