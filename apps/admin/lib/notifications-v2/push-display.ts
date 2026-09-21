/**
 * Notifications v2, SYSTEM set: how a push notification looks on a phone.
 *
 * The admin's copy of apps/portal/src/lib/notifications-v2/push-display.ts. The
 * model is identical — a push from the super admin dashboard goes out through
 * the same `send-push` function to the same phones — so only the header differs
 * and the `PushTemplate` type comes from this app's ./types. Tests pin the
 * behaviour and the two hard caps; they do not pin this file against the
 * portal's, because the two may diverge if the system set ever needs a
 * different device profile.
 *
 * The push preview draws an iPhone lock-screen card and an Android
 * notification-shade card at the sizes below and clamps the text with CSS
 * `line-clamp`, so the "…" falls roughly where the phone puts it (build-spec
 * D16, transcript §3.9).
 *
 * THIS IS AN APPROXIMATION, and the page says so. No API reports where a phone
 * truncates. It depends on the model, the system font and text size, the
 * language, collapsed vs expanded, and (Android) whether the site was installed
 * or runs in a browser tab, which adds an origin line. The values describe one
 * common phone per platform at the default text size:
 *
 *   iPhone  iPhone 15 / 16 (393pt wide), iOS 17-18 lock screen and banner.
 *           Card inset ~8pt a side, 14pt padding, a 38pt app icon and a 10pt
 *           gap leave ~301pt for text. SF Pro Text 15pt: the title semibold,
 *           the body regular, ~20pt lines. The title row also carries the time
 *           ("now"), ~28pt. Collapsed: 1 title line and up to 4 body lines;
 *           a long-press expands to the whole text.
 *   Android Pixel 8 (412dp wide), Android 14 shade, Chrome web push. Shade
 *           margins, 16dp padding, the 40dp app-icon column, the expand
 *           chevron and the large icon Chrome shows on the right (the push
 *           `icon`) leave ~240dp for text. Roboto / Google Sans Text 14sp: the
 *           title medium, the body regular, 20sp lines. Collapsed: 1 title line
 *           and 1 body line. Expanded (Chrome uses BigTextStyle): the title
 *           stays on 1 line and the body shows up to ~7 lines.
 *
 * Sources: Apple HIG (Notifications) and Material 3 notification specs for the
 * type sizes and structure; widths are measured from screenshots of the same
 * devices. Treat every number as "about".
 *
 * `send-push` itself trims the title to 100 and the body to 300 characters
 * (supabase/functions/send-push/index.ts MAX_TITLE / MAX_BODY, `.trim().slice`),
 * silently. Those two caps are exact; everything else here is an estimate.
 *
 * No React here. v2 only: nothing in v1 imports this file.
 */

import type { PushTemplate } from "./types";

/* -------------------------------------------------------------------------- */
/* Caps                                                                        */
/* -------------------------------------------------------------------------- */

/** `send-push` MAX_TITLE: the title is cut here when sent. */
export const PUSH_TITLE_MAX = 100;
/** `send-push` MAX_BODY: the body is cut here when sent. */
export const PUSH_BODY_MAX = 300;

/* -------------------------------------------------------------------------- */
/* Device profiles                                                             */
/* -------------------------------------------------------------------------- */

export type PushDevice = "iphone" | "android";

export interface PushTextStyle {
  /** CSS px (pt / dp at 1x). */
  fontSize: number;
  fontWeight: number;
  /** CSS px. */
  lineHeight: number;
  /** Average glyph width as a share of the font size, for estimates only. */
  avgCharWidth: number;
  /** Lines shown before the "…". */
  maxLines: { collapsed: number; expanded: number };
}

export interface PushDeviceProfile {
  id: PushDevice;
  /** Label for the device switcher. */
  label: string;
  /** Screen width of the reference phone, CSS px. */
  screenWidth: number;
  /** Width of the notification card, CSS px. */
  cardWidth: number;
  /** Width of the text column inside the card, CSS px. */
  contentWidth: number;
  /** Space the title row gives up to the time on the right, CSS px (0 when the time sits elsewhere). */
  titleReserve: number;
  /** App icon size in the card, CSS px. */
  iconSize: number;
  /** Card corner radius, CSS px. */
  cardRadius: number;
  /** CSS font stack that looks closest to the phone's system font. */
  fontFamily: string;
  title: PushTextStyle;
  body: PushTextStyle;
  /** One plain sentence for the preview's "approximate" note. */
  note: string;
}

export const PUSH_DEVICE_PROFILES: Record<PushDevice, PushDeviceProfile> = {
  iphone: {
    id: "iphone",
    label: "iPhone",
    screenWidth: 393,
    cardWidth: 377,
    contentWidth: 301,
    titleReserve: 28,
    iconSize: 38,
    cardRadius: 22,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
    title: {
      fontSize: 15,
      fontWeight: 600,
      lineHeight: 20,
      avgCharWidth: 0.52,
      maxLines: { collapsed: 1, expanded: 4 },
    },
    body: {
      fontSize: 15,
      fontWeight: 400,
      lineHeight: 20,
      avgCharWidth: 0.49,
      // Expanded shows the whole text; 300 characters take about 8 lines.
      maxLines: { collapsed: 4, expanded: 12 },
    },
    note: "Lock screen on a recent iPhone at the standard text size.",
  },
  android: {
    id: "android",
    label: "Android",
    screenWidth: 412,
    cardWidth: 388,
    contentWidth: 240,
    titleReserve: 0,
    iconSize: 40,
    cardRadius: 24,
    fontFamily: 'Roboto, "Google Sans Text", "Segoe UI", Arial, sans-serif',
    title: {
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      avgCharWidth: 0.53,
      maxLines: { collapsed: 1, expanded: 1 },
    },
    body: {
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 20,
      avgCharWidth: 0.5,
      maxLines: { collapsed: 1, expanded: 7 },
    },
    note: "Notification shade on a recent Android phone in Chrome, at the standard text size.",
  },
};

export const PUSH_DEVICES: readonly PushDevice[] = ["iphone", "android"] as const;

/** The line the preview shows under the mockups. */
export const PUSH_PREVIEW_APPROXIMATE_NOTE =
  "Approximate. Every phone's font, text size and screen width differ a little, so the cut-off can move by a few characters.";

/* -------------------------------------------------------------------------- */
/* Estimates                                                                   */
/* -------------------------------------------------------------------------- */

export type PushTextPart = "title" | "body";

/** Characters that fit on one line of a part, by the average-glyph model. */
export function charsPerLine(profile: PushDeviceProfile, part: PushTextPart = "body", firstLine = true): number {
  const style = profile[part];
  const width = profile.contentWidth - (part === "title" && firstLine ? profile.titleReserve : 0);
  return Math.max(1, Math.floor(width / (style.fontSize * style.avgCharWidth)));
}

/**
 * How many characters of `text` show in `lines` lines before the phone cuts it
 * with "…". Returns `text.length` when it all fits.
 *
 * The model: word-wrap greedily with an average glyph width (a line never
 * breaks inside a word unless the word is longer than the line), honour line
 * breaks in the text, and on the last visible line cut mid-word, leaving room
 * for the "…", as iOS and Android both do. Good enough for hints and tests; the
 * preview itself uses CSS line-clamp with the real fonts.
 */
export function estimateVisibleChars(
  text: string,
  profile: PushDeviceProfile,
  lines: number,
  part: PushTextPart = "body",
): number {
  const src = String(text ?? "");
  if (!src) return 0;
  const maxLines = Math.max(1, Math.floor(lines));
  let pos = 0;
  for (let line = 0; line < maxLines; line++) {
    const cpl = charsPerLine(profile, part, line === 0);
    // Skip the spaces a wrapped line starts with (not after a hard break).
    if (line > 0 && src.charAt(pos - 1) !== "\n") {
      while (pos < src.length && src.charAt(pos) === " ") pos++;
    }
    const rest = src.slice(pos);
    const nl = rest.indexOf("\n");
    const segment = nl === -1 ? rest : rest.slice(0, nl);
    const isLast = line === maxLines - 1;

    if (segment.length <= cpl) {
      // The segment fits on this line.
      if (nl === -1) return src.length;
      if (isLast) return pos + segment.length; // the text after the break is hidden
      pos += segment.length + 1;
      continue;
    }
    if (isLast) return pos + Math.max(0, cpl - 1); // leave room for "…"

    // Break at the last space that fits; a word longer than the line breaks anywhere.
    const window = segment.slice(0, cpl + 1);
    const space = window.lastIndexOf(" ");
    pos += space > 0 ? space : cpl;
  }
  return src.length;
}

export interface PushTruncation {
  /** The text as the phone would show it, with "…" when cut. */
  shown: string;
  truncated: boolean;
  visibleChars: number;
}

/** `estimateVisibleChars` as displayable text. */
export function estimateTruncation(
  text: string,
  profile: PushDeviceProfile,
  lines: number,
  part: PushTextPart = "body",
): PushTruncation {
  const src = String(text ?? "");
  const visibleChars = estimateVisibleChars(src, profile, lines, part);
  const truncated = visibleChars < src.length;
  return {
    shown: truncated ? src.slice(0, visibleChars).replace(/\s+$/, "") + "…" : src,
    truncated,
    visibleChars,
  };
}

/* -------------------------------------------------------------------------- */
/* Hints                                                                       */
/* -------------------------------------------------------------------------- */

/** Rounds down to a friendly number for "about N characters". */
function about(n: number): number {
  return n >= 20 ? Math.floor(n / 5) * 5 : n;
}

/** Characters one line of `part` holds on the narrowest phone. */
function narrowestLine(part: PushTextPart): number {
  return Math.min(...PUSH_DEVICES.map((d) => charsPerLine(PUSH_DEVICE_PROFILES[d], part)));
}

/**
 * Operator-facing hints about length, most important first. Pass the text as
 * it will be sent (variables filled with example values) for the best estimate.
 * The two caps count exactly as `send-push` does (trimmed, UTF-16 length).
 */
export function pushLengthWarnings(template: Partial<PushTemplate> | null | undefined): string[] {
  const title = String(template?.title ?? "").trim();
  const body = String(template?.body ?? "").trim();
  const hints: string[] = [];
  const iphone = PUSH_DEVICE_PROFILES.iphone;
  const android = PUSH_DEVICE_PROFILES.android;

  if (title.length > PUSH_TITLE_MAX) {
    hints.push(`Titles are cut at ${PUSH_TITLE_MAX} characters when sent. This one has ${title.length}.`);
  }
  if (body.length > PUSH_BODY_MAX) {
    hints.push(`Messages are cut at ${PUSH_BODY_MAX} characters when sent. This one has ${body.length}.`);
  }

  const titleCut = PUSH_DEVICES.some((d) => {
    const p = PUSH_DEVICE_PROFILES[d];
    return estimateVisibleChars(title, p, p.title.maxLines.collapsed, "title") < title.length;
  });
  if (title && titleCut) {
    hints.push(
      `Titles over ~${about(narrowestLine("title"))} characters are usually cut off on phones. Put the key words first.`,
    );
  }

  // Android's collapsed card shows a single body line, so nearly every message
  // is cut there; the preview shows that, and a hint for it would never go away.
  if (body) {
    const androidOpen = estimateVisibleChars(body, android, android.body.maxLines.expanded, "body");
    const iphoneShut = estimateVisibleChars(body, iphone, iphone.body.maxLines.collapsed, "body");
    if (androidOpen < body.length && body.length <= PUSH_BODY_MAX) {
      hints.push(
        `Even expanded, Android shows only about ${about(androidOpen)} characters of the message. Consider making it shorter.`,
      );
    } else if (iphoneShut < body.length) {
      hints.push(
        `An iPhone lock screen shows about ${about(iphoneShut)} characters of the message. The rest shows when the notification is expanded.`,
      );
    }
  }
  return hints;
}
