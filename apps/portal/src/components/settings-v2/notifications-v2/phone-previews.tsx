"use client";

/**
 * Notifications v2: whole-phone previews for the App message (Oct 1 2026).
 *
 * One App message feeds both the phone push and the bell, so the right rail
 * shows it the two ways it lands, each on a full phone, end to end:
 *   - LockScreenPhone / AndroidLockScreenPhone: the lock screen with the push
 *     on it, iPhone and Android side by side (Oct 1 2026).
 *   - InAppPhone: the app open on the phone (this portal for your team, the
 *     booking site for customers) with the bell's panel dropped open on the
 *     same message — the real bell rows from inapp-preview.tsx.
 *
 * Illustrations, not emulators: fonts and widths differ per phone, and the
 * caption under the pair says so. v2 only.
 */

import type { ReactNode } from "react";
import { Bell, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { InAppPreview, type InAppAudience } from "./inapp-preview";
import { pushClampStyle } from "./push-preview-phone";

/** A modern phone at 393 × 852 points, drawn at `width` px. */
export function PhoneFrame({
  children,
  label,
  screenClassName,
  dark = false,
  width = 260,
  os = "ios",
  wallpaper,
}: {
  children: ReactNode;
  label: string;
  screenClassName?: string;
  /** Light status bar text, for dark or photographic screens. */
  dark?: boolean;
  width?: number;
  /** iPhone (dynamic island, rounder) or Android (punch-hole camera). */
  os?: "ios" | "android";
  /** Fills the WHOLE screen, status bar to home bar (no white band at the foot). */
  wallpaper?: string;
}) {
  const android = os === "android";
  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        role="img"
        aria-label={label}
        className={cn(
          "relative bg-neutral-900 shadow-none ring-1 ring-black/10 dark:ring-white/10",
          android ? "rounded-[34px] p-[9px]" : "rounded-[42px] p-[9px]",
        )}
        style={{ width }}
      >
        <div
          className={cn(
            "relative flex flex-col overflow-hidden bg-background",
            android ? "rounded-[26px]" : "rounded-[34px]",
            screenClassName,
          )}
          // One shape for both, so the pair stands the same height side by side.
          style={{ aspectRatio: "393 / 852", background: wallpaper }}
        >
          {/* Status bar + dynamic island. */}
          <div
            aria-hidden="true"
            className={cn(
              "relative z-20 flex h-9 shrink-0 items-center justify-between px-6 text-[11px] font-semibold",
              dark ? "text-white" : "text-foreground",
            )}
          >
            <span>9:41</span>
            {android ? (
              <span className="absolute left-1/2 top-2.5 size-3 -translate-x-1/2 rounded-full bg-black" />
            ) : (
              <span className="absolute left-1/2 top-2 h-[22px] w-[78px] -translate-x-1/2 rounded-full bg-black" />
            )}
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-[2px] border border-current" />
            </span>
          </div>
          <div className="relative min-h-0 flex-1">{children}</div>
          {/* Home indicator. */}
          <div aria-hidden="true" className="flex h-5 shrink-0 items-center justify-center">
            <span className={cn("rounded-full", android ? "h-[3px] w-20" : "h-1 w-24", dark ? "bg-white/80" : "bg-foreground/70")} />
          </div>
        </div>
      </div>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** Edit in place on a phone: plain text, committed on blur or Enter. */
export type PhoneEdit = { onTitle?: (text: string) => void; onBody?: (text: string) => void };

function editable(commit: ((text: string) => void) | undefined) {
  if (!commit) return {};
  return {
    contentEditable: "plaintext-only" as unknown as boolean,
    suppressContentEditableWarning: true,
    spellCheck: false,
    title: "Click to edit",
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) =>
      commit((e.currentTarget.innerText ?? "").replace(/\u00a0/g, " ").replace(/\s*\n\s*/g, " ").trim()),
  };
}

/** While editing, the clamp is lifted so the whole text shows. */
/**
 * The edit affordance: a soft wash, not a box. Padding is paid back with a
 * negative margin so the text never moves; hover is a faint tint, editing a
 * slightly stronger one with a hairline ring. 200ms, per the motion standard.
 */
const EDIT_RING =
  "-mx-1.5 -my-0.5 cursor-text rounded-lg px-1.5 py-0.5 outline-none transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none " +
  "hover:bg-black/[0.05] dark:hover:bg-white/10 focus:bg-black/[0.06] focus:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)] dark:focus:bg-white/10 " +
  "focus:[-webkit-line-clamp:unset] focus:[display:block]";

const WALLPAPER = "linear-gradient(165deg, #4f6fd0 0%, #8a67c9 48%, #e39aa3 100%)";

function AppIcon({ appName, iconUrl }: { appName: string; iconUrl?: string | null }) {
  return iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={iconUrl} alt="" className="size-7 shrink-0 rounded-[7px] bg-white object-cover" />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-[12px] font-semibold text-primary-foreground">
      {(appName.trim()[0] ?? "D").toUpperCase()}
    </span>
  );
}

/** The lock screen with this push on it. */
export function LockScreenPhone({
  title,
  body,
  appName,
  iconUrl,
  dark = false,
  edit,
}: {
  title: string;
  body: string;
  appName: string;
  iconUrl?: string | null;
  /** The phone in dark mode: iOS draws the notification as a dark card. */
  dark?: boolean;
  edit?: PhoneEdit;
}) {
  const shownTitle = title.trim() || appName;
  return (
    <PhoneFrame label="iPhone" dark screenClassName="text-white" wallpaper={WALLPAPER}>
      <div className="relative flex h-full flex-col items-center px-3 pt-2">
        <p className="text-[12px] font-semibold opacity-90">Wednesday 1 October</p>
        <p className="text-[54px] font-semibold leading-none tracking-tight">9:41</p>
        <div
          className={cn(
            "mt-5 w-full rounded-[18px] p-2.5 backdrop-blur-xl",
            dark ? "bg-neutral-800/80 text-white" : "bg-white/80 text-black",
          )}
        >
          <div className="flex items-start gap-2">
            <AppIcon appName={appName} iconUrl={iconUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn("min-w-0 text-[12px] font-semibold", edit?.onTitle && EDIT_RING)} style={pushClampStyle(1)} {...editable(edit?.onTitle)}>
                  {shownTitle}
                </p>
                <span className={cn("shrink-0 text-[10px]", dark ? "text-white/50" : "text-black/50")}>now</span>
              </div>
              {body.trim() && (
                <p className={cn("text-[11.5px] leading-snug", edit?.onBody && EDIT_RING)} style={pushClampStyle(4)} {...editable(edit?.onBody)}>
                  {body}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

const ANDROID_WALLPAPER = "linear-gradient(170deg, #1f4f5a 0%, #2f6f68 45%, #9fc7a8 100%)";

/** Android: the lock screen with this push, Material style (app row, then title and text). */
export function AndroidLockScreenPhone({
  title,
  body,
  appName,
  iconUrl,
  dark = false,
  edit,
}: {
  title: string;
  body: string;
  appName: string;
  iconUrl?: string | null;
  dark?: boolean;
  edit?: PhoneEdit;
}) {
  const shownTitle = title.trim() || appName;
  return (
    <PhoneFrame label="Android" os="android" dark screenClassName="text-white" wallpaper={ANDROID_WALLPAPER}>
      <div className="relative flex h-full flex-col px-3 pt-3">
        <p className="text-[50px] font-light leading-none tracking-tight">9:41</p>
        <p className="mt-1 text-[12px] font-medium opacity-90">Wed, 1 Oct</p>
        <div
          className={cn(
            "mt-5 w-full rounded-[22px] p-3",
            dark ? "bg-neutral-800/90 text-white" : "bg-white/90 text-neutral-900",
          )}
        >
          <div className="flex items-center gap-1.5">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconUrl} alt="" className="size-4 shrink-0 rounded-full bg-white object-cover" />
            ) : (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground">
                {(appName.trim()[0] ?? "D").toUpperCase()}
              </span>
            )}
            <span className={cn("min-w-0 truncate text-[10px]", dark ? "text-white/70" : "text-neutral-600")}>
              {appName} · now
            </span>
          </div>
          <p className={cn("mt-1.5 text-[12.5px] font-semibold", edit?.onTitle && EDIT_RING)} style={pushClampStyle(1)} {...editable(edit?.onTitle)}>
            {shownTitle}
          </p>
          {body.trim() && (
            <p
              className={cn("text-[11.5px] leading-snug", dark ? "text-white/80" : "text-neutral-700", edit?.onBody && EDIT_RING)}
              style={pushClampStyle(3)}
              {...editable(edit?.onBody)}
            >
              {body}
            </p>
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}

/** The app open on the phone, with the bell's panel dropped open on this message. */
export function InAppPhone({
  title,
  body,
  audience,
  companyName,
  accentColor,
  link,
  dark = false,
}: {
  title: string;
  body: string;
  audience: InAppAudience;
  companyName: string;
  accentColor?: string | null;
  link?: string | null;
  /** The phone in dark mode. Drawn by inverting the screen, as phones do for apps without their own dark theme. */
  dark?: boolean;
}) {
  const name = companyName.trim() || "Your company";
  return (
    <PhoneFrame
      label={audience === "team" ? "Bell, in this portal on a phone" : "Bell, on your booking site on a phone"}
      // The whole screen is inverted, status bar included, so the frame stays "light".
      screenClassName={dark ? "[filter:invert(1)_hue-rotate(180deg)]" : undefined}
    >
      {/* The app's top bar: menu, the company, and the bell with its dot. */}
      <div className="flex h-11 items-center justify-between border-b px-3">
        <Menu className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="truncate px-2 text-[12px] font-semibold">{name}</span>
        <span className="relative">
          <Bell className="size-4 text-foreground" aria-hidden="true" />
          <span className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-destructive text-[7px] font-bold text-white">
            1
          </span>
        </span>
      </div>
      {/* The page behind, dimmed while the panel is open. */}
      <div aria-hidden="true" className="space-y-2 p-3 opacity-60">
        <div className="h-3 w-1/2 rounded-full bg-muted" />
        <div className="h-16 rounded-xl bg-muted/70" />
        <div className="h-16 rounded-xl bg-muted/70" />
        <div className="h-16 rounded-xl bg-muted/70" />
      </div>
      <div aria-hidden="true" className="absolute inset-0 top-11 bg-black/25" />
      <div className="absolute inset-x-2 top-12">
        <InAppPreview
          title={title}
          body={body}
          audience={audience}
          companyName={name}
          accentColor={accentColor}
          link={link}
          className="text-[0.92em] [&>p]:hidden [&_[data-inapp-mockup]]:max-w-none [&_[data-inapp-mockup]]:shadow-lg"
        />
      </div>
    </PhoneFrame>
  );
}
