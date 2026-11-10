/*
 * Captions for the founder films.
 *
 * PLACEHOLDER TEXT. These lines are generic stand-ins, timed evenly, until the final films
 * and Ghulam's captions guide arrive (2026-11-10). They are NOT what the founder says on
 * film. Replace every cue with the real transcript, word-timed, before this goes live.
 *
 *   Captions   one short line at a time on the film, set as illustrated type: bold words that
 *              pop in as they are "said", and the key words (marked *like this* in the
 *              text) in bold brand purple. No icons, no tag behind them.
 */

import type { ReactNode } from "react";

export type Cue = {
  /** Seconds into the film. */
  from: number;
  to: number;
  /** The line. Words between asterisks are the key words, set on the tag. */
  text: string;
};

export const CAPTIONS: Record<string, Cue[]> = {
  "founder-turo": [
    { from: 0, to: 4.2, text: "Picture this: you wake up and your account is *gone.*" },
    { from: 4.2, to: 8.6, text: "Every listing, every review, *every booking* with it." },
    { from: 8.6, to: 13, text: "That is why your business needs a *home of its own.*" },
    { from: 13, to: 17.3, text: "Somewhere *nobody else* can switch off." },
  ],
  "founder-own-customers": [
    { from: 0, to: 3.6, text: "On a marketplace, the renter *belongs to them.*" },
    { from: 3.6, to: 7.3, text: "You can't *call them back* or bring them back." },
    { from: 7.3, to: 11, text: "On your own site, every renter is *your customer.*" },
    { from: 11, to: 14.5, text: "And they come *straight back* to you." },
  ],
  "founder-trust": [
    { from: 0, to: 4.3, text: "Renters want to know *who they are booking* with." },
    { from: 4.3, to: 8.7, text: "Your own site, your own name, *your own reviews.*" },
    { from: 8.7, to: 13, text: "It looks like a *real business,* because it is one." },
    { from: 13, to: 17.4, text: "That is what makes them *press book.*" },
  ],
  "founder-who-for": [
    { from: 0, to: 4.2, text: "We built this for *independent rental operators.*" },
    { from: 4.2, to: 8.4, text: "Owners running *real fleets,* every single day." },
    { from: 8.4, to: 12.5, text: "Your cars, your customers, *your business.*" },
  ],
};

export function cueAt(cues: readonly Cue[] | undefined, time: number): Cue | null {
  return cues?.find((cue) => time >= cue.from && time < cue.to) ?? null;
}

/** The words of a line, each marked if it is one of the key words. */
function wordsOf(text: string) {
  let key = false;
  return text.split(" ").map((raw) => {
    const opens = raw.startsWith("*");
    const closes = raw.endsWith("*") || raw.endsWith("*.") || raw.endsWith("*,");
    if (opens) key = true;
    const word = { text: raw.replace(/\*/g, ""), key };
    if (closes) key = false;
    return word;
  });
}

export function wordCount(cue: Cue): number {
  return cue.text.split(" ").length;
}

/** One caption line: words pop in as they are said, and the key words are set in purple. */
export function CaptionLine({ cue, said }: { cue: Cue; said: number }) {
  const words = wordsOf(cue.text);
  const out: ReactNode[] = [];
  let i = 0;
  while (i < words.length) {
    if (!words[i].key) {
      out.push(
        <span key={i} className={`tc-word${i < said ? " is-said" : ""}`}>
          {words[i].text}
        </span>,
      );
      i += 1;
      continue;
    }
    const start = i;
    const group: ReactNode[] = [];
    while (i < words.length && words[i].key) {
      group.push(
        <span key={i} className={`tc-word${i < said ? " is-said" : ""}`}>
          {words[i].text}
        </span>,
      );
      i += 1;
    }
    out.push(
      <span key={`k${start}`} className={`tc-key${start < said ? " is-said" : ""}`}>
        {group}
      </span>,
    );
  }
  return <>{out}</>;
}
