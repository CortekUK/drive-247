"use client";

/**
 * Notifications v2: the push preview (build-spec D16, transcript §3.9).
 *
 * The lead's point: marketers care exactly where a phone cuts a push off with
 * "…" ("my name is Ghulam Muhyu…"). So the preview draws the two phones at
 * their real notification sizes and lets the browser cut the text:
 *   - iPhone: a lock-screen card (frosted, 22px corners, 38px icon, the title
 *     in bold on one line with "now" beside it, the message on up to 4 lines)
 *     over a wallpaper.
 *   - Android: a notification-shade card ("App • now", the title on one line,
 *     the message on 1 line collapsed or 7 expanded, the icon on the right),
 *     with the "Open in app" button when it is on (Chrome shows buttons;
 *     iPhone does not).
 *
 * How the "…" is placed:
 *   - One-line parts (every title, Android's collapsed message) use
 *     `white-space: nowrap; text-overflow: ellipsis`, which cuts mid-word at
 *     the exact pixel the width runs out, as the phones do.
 *   - Multi-line parts use `-webkit-line-clamp`. CSS alone ends the last line
 *     at a word break, while a phone fills the last line and cuts mid-word. So
 *     after layout, a hidden copy of the text is measured with the real font
 *     (`splitForPhone`): the lines before the last are kept as the browser
 *     wrapped them, and the last line is drawn as one nowrap/ellipsis line. If
 *     measuring isn't possible the CSS clamp stays, one word off at worst.
 * It is still approximate, and the caption says so: fonts and widths vary.
 *
 * DEVICE SIZES. The profiles below mirror `PUSH_DEVICE_PROFILES` in
 * lib/notifications-v2/push-display.ts (same numbers, same field names), kept
 * here so this file does not depend on that module. `PushDeviceProfile` values
 * satisfy `PushPreviewProfile`, so the page can pass them in through
 * `profiles` and the two stay one source of truth.
 *
 * v2 only: rendered by the v2 Notifications page (northwind canary).
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, ChevronDown, ChevronUp, Smartphone } from "lucide-react";
import type { PushDisplayOptions } from "@/lib/notifications-v2/types";
import { cn } from "@/lib/utils";
import {
  FitToWidth,
  PreviewSwitch,
  letterTileColor,
  letterTileInitial,
  useIsoLayoutEffect,
  type PreviewSwitchOption,
} from "./email-preview-gmail";

/* -------------------------------------------------------------------------- */
/* Device profiles                                                             */
/* -------------------------------------------------------------------------- */

export type PushPreviewDevice = "iphone" | "android";

export interface PushPreviewTextStyle {
  /** CSS px. */
  fontSize: number;
  fontWeight: number;
  /** CSS px. */
  lineHeight: number;
  /** Lines shown before the "…". */
  maxLines: { collapsed: number; expanded: number };
}

/** The subset of push-display's `PushDeviceProfile` the mockups draw with. */
export interface PushPreviewProfile {
  label: string;
  /** Width of the phone screen, CSS px. */
  screenWidth: number;
  /** Width of the notification card, CSS px. */
  cardWidth: number;
  /** Width of the text column inside the card, CSS px. */
  contentWidth: number;
  /** Space the title row gives to the time on its right, CSS px. */
  titleReserve: number;
  iconSize: number;
  cardRadius: number;
  fontFamily: string;
  title: PushPreviewTextStyle;
  body: PushPreviewTextStyle;
}

export const PUSH_PREVIEW_PROFILES: Record<PushPreviewDevice, PushPreviewProfile> = {
  iphone: {
    label: "iPhone",
    screenWidth: 393,
    cardWidth: 377,
    contentWidth: 301,
    titleReserve: 28,
    iconSize: 38,
    cardRadius: 22,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
    title: { fontSize: 15, fontWeight: 600, lineHeight: 20, maxLines: { collapsed: 1, expanded: 4 } },
    body: { fontSize: 15, fontWeight: 400, lineHeight: 20, maxLines: { collapsed: 4, expanded: 12 } },
  },
  android: {
    label: "Android",
    screenWidth: 412,
    cardWidth: 388,
    contentWidth: 240,
    titleReserve: 0,
    iconSize: 40,
    cardRadius: 24,
    fontFamily: 'Roboto, "Google Sans Text", "Segoe UI", Arial, sans-serif',
    title: { fontSize: 14, fontWeight: 500, lineHeight: 20, maxLines: { collapsed: 1, expanded: 1 } },
    body: { fontSize: 14, fontWeight: 400, lineHeight: 20, maxLines: { collapsed: 1, expanded: 7 } },
  },
};

export const PUSH_PREVIEW_DEVICES: readonly PushPreviewDevice[] = ["iphone", "android"];

export const PUSH_PREVIEW_CAPTION = "Approximate: every phone's font and screen width differ a little.";

/** The small notes under the mockup, one per display option that changes something. */
export const PUSH_PREVIEW_NOTES = {
  requireInteraction: "Stays on screen until dismissed (computers only)",
  silent: "No sound",
  replacePrevious: "Replaces the previous one instead of stacking",
  openInAppIphone: "iPhone shows no buttons. Tapping the notification opens the app.",
  openInAppAndroid: "The Open in app button shows on Android, and in Chrome or Edge on a computer.",
} as const;

export const PUSH_OPEN_IN_APP_LABEL = "Open in app";

/** Android's side of the card: the large icon on the right (48px) after a 16px gap. */
const ANDROID_LARGE_ICON = 48;
/** Android's left column: the 40px small-icon circle and a 12px gap. */
const ANDROID_ICON_COLUMN = 52;

/* -------------------------------------------------------------------------- */
/* Line clamping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The CSS that cuts a part at `maxLines` with "…". One line: nowrap +
 * ellipsis (cuts mid-word at the pixel, like a phone). More: line-clamp.
 */
export function pushClampStyle(maxLines: number): CSSProperties {
  if (maxLines <= 1) {
    return { display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" };
  }
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: maxLines,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "pre-line",
    overflowWrap: "break-word",
  };
}

export interface PhoneSplit {
  /** The text of every line before the last, as the browser wrapped it. */
  head: string;
  /** Everything from the start of the last visible line on. */
  tail: string;
}

type MeasurableElement = Pick<HTMLElement, "firstChild" | "ownerDocument" | "getBoundingClientRect" | "offsetHeight">;

const isSpaceCode = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 160;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Where a phone would put the last visible line of `text`, measured on `el`
 * (a hidden, unclamped copy of the text at the part's width and font whose
 * only child is the text node). Returns null when the text fits in `lines`
 * lines, when `lines` < 2, or when the browser can't measure (the CSS clamp
 * then stands). `lineHeight` is the part's CSS line height in px.
 */
export function splitForPhone(
  el: MeasurableElement | null | undefined,
  text: string,
  lines: number,
  lineHeight: number,
): PhoneSplit | null {
  if (!el || !text || lines < 2 || !(lineHeight > 0)) return null;
  const node = el.firstChild as (Node & { length?: number }) | null;
  if (!node || node.nodeType !== 3) return null;
  const doc = el.ownerDocument;
  if (!doc || typeof doc.createRange !== "function") return null;
  let range: Range;
  try {
    range = doc.createRange();
  } catch {
    return null;
  }
  if (typeof range.getBoundingClientRect !== "function") return null;
  const box = el.getBoundingClientRect();
  // Rects are in screen pixels, so a scaled-down mockup scales the line height too.
  const scale = el.offsetHeight > 0 && box.height > 0 ? box.height / el.offsetHeight : 1;
  const lineHeightPx = lineHeight * scale;
  const length = Math.min(text.length, Number(node.length) || 0);

  const lineOf = (index: number): number => {
    try {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return -1;
      return Math.floor(((rect.top + rect.bottom) / 2 - box.top) / lineHeightPx);
    } catch {
      return -1;
    }
  };

  let lastLineStart = -1;
  let overflows = false;
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    if (isSpaceCode(code) || isLowSurrogate(code)) continue;
    const line = lineOf(i);
    if (line < 0) continue;
    if (line >= lines - 1 && lastLineStart < 0) lastLineStart = i;
    if (line >= lines) {
      overflows = true;
      break;
    }
  }
  if (!overflows || lastLineStart <= 0) return null;
  return { head: text.slice(0, lastLineStart).replace(/\s+$/, ""), tail: text.slice(lastLineStart) };
}

/** The last line as the phone draws it: up to a hard line break, where the rest is hidden. */
function lastLineText(tail: string): string {
  const breakAt = tail.indexOf("\n");
  return breakAt === -1 ? tail : `${tail.slice(0, breakAt).replace(/\s+$/, "")}…`;
}

/**
 * One text part of a notification, cut where the phone cuts it. The wrapper
 * carries `data-push-part` and `data-max-lines` so the page and tests can see
 * how it is clamped.
 */
function PhoneText({
  part,
  text,
  maxLines,
  width,
  style,
}: {
  part: "title" | "body";
  text: string;
  maxLines: number;
  width: number;
  style: PushPreviewTextStyle & { fontFamily: string; color: string };
}) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [split, setSplit] = useState<PhoneSplit | null>(null);
  const multiLine = maxLines > 1;

  useIsoLayoutEffect(() => {
    if (!multiLine) {
      setSplit(null);
      return;
    }
    let alive = true;
    const run = () => {
      if (!alive) return;
      const next = splitForPhone(measureRef.current, text, maxLines, style.lineHeight);
      setSplit((prev) => (prev?.head === next?.head && prev?.tail === next?.tail ? prev : next));
    };
    run();
    // System fonts are usually ready; if one arrives late, measure again.
    const fonts = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    fonts?.ready?.then(run).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [text, maxLines, width, multiLine, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight]);

  const font: CSSProperties = {
    width,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: `${style.lineHeight}px`,
    color: style.color,
  };

  return (
    <span
      data-push-part={part}
      data-max-lines={maxLines}
      data-clamp={!multiLine ? "single" : split ? "split" : "css"}
      style={{ position: "relative", display: "block", width, overflow: "hidden" }}
    >
      {split ? (
        <>
          <span style={{ ...font, ...pushClampStyle(maxLines - 1) }}>{split.head}</span>
          <span style={{ ...font, ...pushClampStyle(1) }}>{lastLineText(split.tail)}</span>
        </>
      ) : (
        <span style={{ ...font, ...pushClampStyle(maxLines) }}>{text}</span>
      )}
      {multiLine && (
        <span
          ref={measureRef}
          aria-hidden="true"
          style={{
            ...font,
            position: "absolute",
            left: 0,
            top: 0,
            display: "block",
            visibility: "hidden",
            pointerEvents: "none",
            whiteSpace: "pre-line",
            overflowWrap: "break-word",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Mockup pieces                                                               */
/* -------------------------------------------------------------------------- */

/** The notification's icon: the tenant's image, or a letter tile when there is none or it fails. */
function AppIcon({ url, name, size, radius }: { url?: string | null; name: string; size: number; radius: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const box: CSSProperties = { width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden" };
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a tenant logo URL, drawn at a fixed size
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{ ...box, objectFit: "cover", background: "#ffffff", display: "block" }}
      />
    );
  }
  return (
    <span
      data-push-icon-fallback=""
      style={{
        ...box,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: letterTileColor(name),
        color: "#ffffff",
        fontSize: Math.round(size * 0.46),
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {letterTileInitial(name)}
    </span>
  );
}

function lockScreenDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(date);
  } catch {
    return "";
  }
}

const IOS_WALLPAPER = "linear-gradient(165deg, #4f6fd0 0%, #8a67c9 48%, #e39aa3 100%)";

function IphoneLockScreen({
  profile,
  title,
  body,
  appName,
  iconUrl,
  dateLabel,
}: {
  profile: PushPreviewProfile;
  title: string;
  body: string;
  appName: string;
  iconUrl?: string | null;
  dateLabel: string;
}) {
  // With no title, iOS shows the app's name in the title's place.
  const shownTitle = title.trim() || appName;
  const titleWidth = Math.max(40, profile.contentWidth - profile.titleReserve);
  const ink = "#000000";
  return (
    <div
      data-push-mockup="iphone"
      style={{
        width: profile.screenWidth,
        borderRadius: 44,
        background: IOS_WALLPAPER,
        padding: "22px 0 32px",
        fontFamily: profile.fontFamily,
        overflow: "hidden",
      }}
    >
      <div aria-hidden="true" style={{ textAlign: "center", color: "#ffffff" }}>
        <div suppressHydrationWarning style={{ fontSize: 17, fontWeight: 600, lineHeight: "22px", opacity: 0.92 }}>
          {dateLabel}
        </div>
        <div style={{ fontSize: 78, fontWeight: 600, lineHeight: "86px", letterSpacing: -1.5 }}>9:41</div>
      </div>
      <div
        style={{
          width: profile.cardWidth,
          margin: "30px auto 0",
          padding: 14,
          borderRadius: profile.cardRadius,
          background: "rgba(246, 246, 248, 0.8)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          overflow: "hidden",
        }}
      >
        <AppIcon url={iconUrl} name={appName} size={profile.iconSize} radius={Math.round(profile.iconSize * 0.225)} />
        <div style={{ width: profile.contentWidth, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <PhoneText
              part="title"
              text={shownTitle}
              maxLines={profile.title.maxLines.collapsed}
              width={titleWidth}
              style={{ ...profile.title, fontFamily: profile.fontFamily, color: ink }}
            />
            <span
              style={{
                width: profile.contentWidth - titleWidth,
                flexShrink: 0,
                textAlign: "right",
                fontSize: 13,
                lineHeight: "20px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              now
            </span>
          </div>
          {body.trim() && (
            <PhoneText
              part="body"
              text={body}
              maxLines={profile.body.maxLines.collapsed}
              width={profile.contentWidth}
              style={{ ...profile.body, fontFamily: profile.fontFamily, color: ink }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AndroidShade({
  profile,
  title,
  body,
  appName,
  iconUrl,
  expanded,
  openInApp,
  timeLabel,
}: {
  profile: PushPreviewProfile;
  title: string;
  body: string;
  appName: string;
  iconUrl?: string | null;
  expanded: boolean;
  openInApp: boolean;
  timeLabel: string;
}) {
  const accent = "#0b57d0";
  const state = expanded ? "expanded" : "collapsed";
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <div
      data-push-mockup="android"
      data-android-state={state}
      style={{
        width: profile.screenWidth,
        borderRadius: 28,
        background: "#dfe3ec",
        padding: "12px 0 20px",
        fontFamily: profile.fontFamily,
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{ display: "flex", justifyContent: "space-between", padding: "0 24px 12px", fontSize: 13, color: "#1f1f1f" }}
      >
        <span style={{ fontWeight: 500 }}>9:41</span>
        <span suppressHydrationWarning>{timeLabel}</span>
      </div>
      <div
        style={{
          width: profile.cardWidth,
          margin: "0 auto",
          padding: 16,
          borderRadius: profile.cardRadius,
          background: "#fdfcff",
          color: "#1d1b20",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: ANDROID_ICON_COLUMN - 40 }}>
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: accent,
              color: "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Bell size={20} strokeWidth={2.2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 20 }}>
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  fontSize: 12,
                  lineHeight: "16px",
                  color: "#49454f",
                }}
              >
                {appName} • now
              </span>
              <span
                aria-hidden="true"
                style={{
                  marginLeft: "auto",
                  width: 28,
                  height: 20,
                  borderRadius: 10,
                  background: "#ece6f0",
                  color: "#1d1b20",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Chevron size={14} />
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 2 }}>
              <div style={{ width: profile.contentWidth, minWidth: 0 }}>
                {title.trim() && (
                  <PhoneText
                    part="title"
                    text={title}
                    maxLines={expanded ? profile.title.maxLines.expanded : profile.title.maxLines.collapsed}
                    width={profile.contentWidth}
                    style={{ ...profile.title, fontFamily: profile.fontFamily, color: "#1d1b20" }}
                  />
                )}
                {body.trim() && (
                  <PhoneText
                    part="body"
                    text={body}
                    maxLines={expanded ? profile.body.maxLines.expanded : profile.body.maxLines.collapsed}
                    width={profile.contentWidth}
                    style={{ ...profile.body, fontFamily: profile.fontFamily, color: "#49454f" }}
                  />
                )}
              </div>
              <AppIcon url={iconUrl} name={appName} size={ANDROID_LARGE_ICON} radius={8} />
            </div>
          </div>
        </div>
        {openInApp && (
          <div
            data-push-action="open-in-app"
            style={{ display: "flex", gap: 8, marginTop: 12, paddingLeft: ANDROID_ICON_COLUMN }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 32,
                padding: "0 12px",
                marginLeft: -12,
                borderRadius: 16,
                color: accent,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {PUSH_OPEN_IN_APP_LABEL}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The preview                                                                 */
/* -------------------------------------------------------------------------- */

export interface PushPreviewPhoneProps {
  /** Title with variables already filled. */
  title: string;
  /** Message with variables already filled. */
  body: string;
  /** The name the phone shows for the app (the company name). */
  appName: string;
  /** The icon the push carries (the tenant's logo); a letter tile stands in without one. */
  iconUrl?: string | null;
  options?: PushDisplayOptions | null;
  /** The phone shown first; follows the prop when it changes. */
  device?: PushPreviewDevice;
  onDeviceChange?: (device: PushPreviewDevice) => void;
  /** Android opens expanded instead of collapsed. */
  defaultExpanded?: boolean;
  /** Device sizes, e.g. `PUSH_DEVICE_PROFILES` from push-display.ts. Defaults to the same numbers. */
  profiles?: Partial<Record<PushPreviewDevice, PushPreviewProfile>>;
  className?: string;
}

const DEVICE_OPTIONS: readonly PreviewSwitchOption<PushPreviewDevice>[] = [
  { value: "iphone", label: "iPhone", icon: Smartphone },
  { value: "android", label: "Android", icon: Smartphone },
];

const ANDROID_STATE_OPTIONS: readonly PreviewSwitchOption<"collapsed" | "expanded">[] = [
  { value: "collapsed", label: "Collapsed" },
  { value: "expanded", label: "Expanded" },
];

export function PushPreviewPhone({
  title,
  body,
  appName,
  iconUrl,
  options,
  device: deviceProp,
  onDeviceChange,
  defaultExpanded = false,
  profiles,
  className,
}: PushPreviewPhoneProps) {
  const [device, setDevice] = useState<PushPreviewDevice>(deviceProp ?? "iphone");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (deviceProp) setDevice(deviceProp);
  }, [deviceProp]);

  const changeDevice = (next: PushPreviewDevice) => {
    setDevice(next);
    onDeviceChange?.(next);
  };

  const profile = profiles?.[device] ?? PUSH_PREVIEW_PROFILES[device];
  const shownApp = String(appName ?? "").trim() || "Your company";
  const shownTitle = String(title ?? "");
  const shownBody = String(body ?? "");
  const opts = options ?? {};
  const openInApp = !!opts.openInApp;
  const dateLabel = lockScreenDate(now);

  const notes: string[] = [];
  if (openInApp) notes.push(device === "iphone" ? PUSH_PREVIEW_NOTES.openInAppIphone : PUSH_PREVIEW_NOTES.openInAppAndroid);
  if (opts.requireInteraction) notes.push(PUSH_PREVIEW_NOTES.requireInteraction);
  if (opts.silent) notes.push(PUSH_PREVIEW_NOTES.silent);
  if (opts.replacePrevious) notes.push(PUSH_PREVIEW_NOTES.replacePrevious);

  const where = device === "iphone" ? "iPhone lock screen" : `Android notification, ${expanded ? "expanded" : "collapsed"}`;
  const label = `${where} preview. From ${shownApp}: ${shownTitle.trim() || shownApp}. ${shownBody.trim()}${
    device === "android" && openInApp ? ` Button: ${PUSH_OPEN_IN_APP_LABEL}.` : ""
  }`;

  return (
    <div className={cn("min-w-0 space-y-3", className)} data-device={device}>
      <div className="flex flex-wrap items-center gap-2">
        <PreviewSwitch label="Phone" value={device} options={DEVICE_OPTIONS} onChange={changeDevice} />
        {device === "android" && (
          <PreviewSwitch
            label="Android notification size"
            value={expanded ? "expanded" : "collapsed"}
            options={ANDROID_STATE_OPTIONS}
            onChange={(value) => setExpanded(value === "expanded")}
          />
        )}
      </div>
      <FitToWidth naturalWidth={profile.screenWidth}>
        <div role="img" aria-label={label}>
          {device === "iphone" ? (
            <IphoneLockScreen
              profile={profile}
              title={shownTitle}
              body={shownBody}
              appName={shownApp}
              iconUrl={iconUrl}
              dateLabel={dateLabel}
            />
          ) : (
            <AndroidShade
              profile={profile}
              title={shownTitle}
              body={shownBody}
              appName={shownApp}
              iconUrl={iconUrl}
              expanded={expanded}
              openInApp={openInApp}
              timeLabel={dateLabel}
            />
          )}
        </div>
      </FitToWidth>
      {notes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="How this notification behaves">
          {notes.map((note) => (
            <li key={note} className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{PUSH_PREVIEW_CAPTION}</p>
    </div>
  );
}
