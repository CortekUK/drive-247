"use client";

/**
 * Notifications v2 › Setups › Push notifications: installing the portal and
 * allowing push, per device (Ghulam, Oct 1 2026).
 *
 *   InstallAppButton  "Install app". In Chrome it opens Chrome's own install
 *                     prompt (beforeinstallprompt). Where a browser cannot do
 *                     that (iPhone, Firefox, an already-dismissed prompt) it
 *                     selects this device's steps in the guide instead. Shows
 *                     "Installed" when the portal is already running as an app.
 *   PushInstallGuide  Three cards, iPhone / Android / Computer. The chosen one's
 *                     steps show right under them, all at once and side by
 *                     side: a drawn picture of what the operator will see, then
 *                     the step. No dialog and no scrolling.
 *
 * Browser support, stated in every dialog:
 *   Computer and Android  Google Chrome.
 *   iPhone                Apple only delivers web push to a site added to the
 *                         Home Screen from Safari, on iOS 16.4 or newer.
 *
 * The pictures are illustrations built here (not screenshots), so they follow
 * the theme and never go stale with a browser's icons. v2 only.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Bell, Check, Send, Download, Globe, Lock, MoreVertical, Plus, Search, Share,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";
import { AndroidIcon, AppleIcon, ChromeIcon } from "./brand-icons";

type Platform = "iphone" | "android" | "computer";

/** The device in hand: iPhone / iPad, Android, or anything else. */
function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "computer";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "computer";
}

interface GuideStep {
  title: string;
  body: ReactNode;
  picture: ReactNode;
}

interface GuideProps {
  host: string;
  name: string;
  iconUrl?: string | null;
}

const PLATFORMS: Record<Platform, { label: string; browser: string; icon: ComponentType<{ className?: string }>; note: string }> = {
  iphone: {
    label: "iPhone",
    browser: "Safari",
    icon: AppleIcon,
    note: "Apple only allows push from Safari, after you add the portal to your Home Screen, on iOS 16.4 or newer. Chrome on iPhone can't receive push.",
  },
  android: {
    label: "Android",
    browser: "Google Chrome",
    icon: AndroidIcon,
    note: "Use Google Chrome. Other Android browsers may not deliver push.",
  },
  computer: {
    label: "Computer",
    browser: "Google Chrome",
    icon: ChromeIcon,
    note: "Use Google Chrome on Mac or Windows. Other browsers may not deliver push.",
  },
};

function stepsFor(platform: Platform, { host, name, iconUrl }: GuideProps): GuideStep[] {
  const site = <span className="font-medium text-foreground">{host}</span>;
  if (platform === "iphone") {
    return [
      { title: "Open the portal in Safari", body: <>Use Safari, not Chrome. Go to {site} and sign in.</>, picture: <MiniSafariBar host={host} /> },
      { title: "Tap the Share button", body: "It's the square with an arrow pointing up, at the bottom of the screen (at the top on an iPad).", picture: <MiniSafariToolbar /> },
      { title: "Tap Add to Home Screen, then Add", body: "Scroll down the list if you don't see it. Keep the name as it is.", picture: <MiniShareSheet /> },
      { title: "Open it from your Home Screen", body: "Always open the portal from this new icon, not from Safari. Sign in again if it asks.", picture: <MiniHomeScreen name={name} iconUrl={iconUrl} /> },
      { title: "Turn push on, then tap Allow", body: "In the portal go to Settings, Notifications, Setups, Push notifications, and turn it on. Tap Allow when your iPhone asks.", picture: <MiniPermission os="ios" name={name} /> },
      { title: "Check your iPhone settings", body: <>iPhone Settings, Notifications, {name}: Allow Notifications on. A Focus mode can hide alerts.</>, picture: <MiniToggleRow label={name} /> },
    ];
  }
  if (platform === "android") {
    return [
      { title: "Open the portal in Chrome", body: <>Go to {site} and sign in.</>, picture: <MiniChromeMobileBar host={host} /> },
      { title: "Tap ⋮, then Install app", body: "The three dots are at the top right. On some phones it says Add to Home screen, then Install.", picture: <MiniChromeMenu item="Install app" /> },
      { title: "Open it from your home screen", body: "It also appears in your app drawer. Sign in again if it asks.", picture: <MiniHomeScreen name={name} iconUrl={iconUrl} android /> },
      { title: "Turn push on, then tap Allow", body: "Settings, Notifications, Setups, Push notifications: turn it on, and tap Allow when Android asks.", picture: <MiniPermission os="android" name={name} /> },
      { title: "Check your phone settings", body: <>Settings, Apps, {name} (or Chrome), Notifications: on. Battery saver can delay alerts.</>, picture: <MiniToggleRow label={name} /> },
    ];
  }
  return [
    { title: "Open the portal in Google Chrome", body: <>On a Mac or a Windows computer, go to {site} and sign in.</>, picture: <MiniDesktopBar host={host} /> },
    { title: "Install it as an app", body: "Click Install app on this page, or the install icon at the right end of Chrome's address bar. It then opens in its own window.", picture: <MiniDesktopBar host={host} highlightInstall /> },
    { title: "Turn push on, then click Allow", body: "Settings, Notifications, Setups, Push notifications: turn it on. Chrome asks under the address bar; click Allow.", picture: <MiniDesktopPermission /> },
    { title: "Let your computer show Chrome's alerts", body: "Mac: System Settings, Notifications, Google Chrome, Allow notifications. Windows: Settings, System, Notifications, Google Chrome on. Turn off Do Not Disturb or Focus.", picture: <MiniToggleRow label="Google Chrome" /> },
    { title: "Send yourself a test", body: "Use Send test on this page. The alert should appear in the corner of your screen within a few seconds.", picture: <MiniToast name={name} /> },
  ];
}

/* -------------------------------------------------------------------------- */
/* Install app                                                                 */
/* -------------------------------------------------------------------------- */

/** Chrome's install event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Kept at module level: Chrome fires the event once, possibly before this mounts. */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallAppButton({ onNoPrompt }: { onNoPrompt: (platform: Platform) => void }) {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(isInstalled());
    const done = () => setInstalled(true);
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
  }, []);

  const install = async () => {
    if (deferredPrompt) {
      const event = deferredPrompt;
      deferredPrompt = null;
      await event.prompt();
      const choice = await event.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") setInstalled(true);
      return;
    }
    // No prompt to show (iPhone, another browser, or dismissed before): the guide.
    onNoPrompt(detectPlatform());
  };

  return (
    <>
      {installed ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="size-4" aria-hidden="true" />
          Installed on this device
        </span>
      ) : (
        <Button type="button" className="rounded-full" onClick={() => void install()}>
          <Download data-icon="inline-start" aria-hidden="true" />
          Install app
        </Button>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The guide: three cards, each opening a step-by-step dialog                   */
/* -------------------------------------------------------------------------- */

export function PushInstallGuide({
  portalHost,
  appName,
  iconUrl,
  className,
}: {
  /** e.g. northwind.portal.drive-247.com */
  portalHost: string;
  appName: string;
  iconUrl?: string | null;
  className?: string;
}) {
  // The chosen device; starts on the one in hand. Its steps show right below
  // the cards, all at once, laid across the width so nothing scrolls
  // (Ghulam, Oct 1 2026: no dialog, there is room under the cards).
  const [platform, setPlatform] = useState<Platform>("computer");
  const [here, setHere] = useState<Platform>("computer");
  useEffect(() => {
    const p = detectPlatform();
    setHere(p);
    setPlatform(p);
  }, []);
  const props: GuideProps = { host: portalHost, name: appName.trim() || "Your company", iconUrl };
  const steps = stepsFor(platform, props);
  const info = PLATFORMS[platform];

  return (
    <section aria-labelledby="push-guide-title" className={cn("space-y-4", className)} data-push-install-guide="">
      {/* The button lines up with the TOP of the heading, not its last line. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="push-guide-title" className="font-heading text-base font-semibold tracking-tight text-foreground">
            Install the app and get push notifications
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Pick your device to see the steps. Each person on your team does this on their own devices.
          </p>
        </div>
        <InstallAppButton onNoPrompt={setPlatform} />
      </div>

      <div role="tablist" aria-label="Your device" className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(PLATFORMS) as Platform[]).map((key) => {
          const p = PLATFORMS[key];
          const on = platform === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPlatform(key)}
              className={cn(
                "relative flex items-center gap-3 rounded-2xl p-3.5 text-left outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
                on
                  ? "bg-primary/[0.12] ring-1 ring-primary/25 dark:bg-[hsl(var(--v2-hover,var(--muted)))]"
                  : "bg-primary/[0.04] hover:bg-primary/[0.08] dark:bg-transparent dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ease-out motion-reduce:transition-none",
                  on ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
                )}
              >
                <p.icon className="size-5" aria-hidden="true" />
              </span>
              {/* The device in hand, flagged in the card's top-right corner. */}
              {key === here && (
                <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                  <span className="size-1.5 rounded-full bg-primary/70" aria-hidden="true" />
                  This device
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-foreground">{p.label}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {p.browser} · {stepsFor(key, props).length} steps
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The browser rule for this device, then every step side by side. */}
      <p className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground" role="note">
        <ChromeIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {info.note}
      </p>
      <ol
        key={platform}
        aria-label={`Steps for ${info.label}`}
        // One row on a wide screen (every step in view, no scrolling); two
        // columns on a narrow one.
        className="grid grid-cols-2 gap-3 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))]"
        style={{ ["--steps" as string]: steps.length }}
      >
        {steps.map((step, i) => (
          <li key={step.title} className="flex min-w-0 flex-col gap-3">
            <div className="flex h-[172px] items-center justify-center rounded-2xl bg-muted/50" aria-hidden="true">
              <div className="origin-center scale-[1.45]">{step.picture}</div>
            </div>
            <div className="min-w-0 px-0.5">
              <p className="flex items-start gap-2 text-[13px] font-semibold leading-snug text-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                {step.title}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The pictures: small drawn mock-ups of what the operator will see             */
/* -------------------------------------------------------------------------- */

const HIGHLIGHT = "ring-2 ring-primary ring-offset-1 ring-offset-background";

function Device({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        "overflow-hidden border-[3px] border-neutral-900 bg-background text-[8px] leading-tight text-foreground",
        // A fixed width: a percentage collapsed to nothing inside the scaled picture box.
        wide ? "w-[136px] rounded-lg" : "h-[104px] w-[64px] rounded-[12px]",
      )}
    >
      {children}
    </div>
  );
}

function MiniSafariBar({ host }: { host: string }) {
  return (
    <Device>
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-1 p-1.5">
          <div className="h-1.5 w-3/4 rounded-full bg-muted" />
          <div className="h-1.5 w-1/2 rounded-full bg-muted" />
          <div className="h-6 rounded bg-muted/70" />
        </div>
        <div className={cn("m-1 flex items-center gap-0.5 rounded-md bg-muted px-1 py-0.5", HIGHLIGHT)}>
          <Lock className="size-1.5 shrink-0" />
          <span className="truncate text-[5px]">{host}</span>
        </div>
      </div>
    </Device>
  );
}

function MiniSafariToolbar() {
  return (
    <Device>
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-1 p-1.5">
          <div className="h-1.5 w-3/4 rounded-full bg-muted" />
          <div className="h-8 rounded bg-muted/70" />
        </div>
        <div className="flex items-center justify-around border-t py-1 text-muted-foreground">
          <span className="text-[7px]">‹</span>
          <span className="text-[7px]">›</span>
          <span className={cn("rounded p-0.5 text-primary", HIGHLIGHT)}>
            <Share className="size-2" />
          </span>
          <span className="text-[7px]">⧉</span>
        </div>
      </div>
    </Device>
  );
}

function MiniShareSheet() {
  return (
    <Device>
      <div className="flex h-full flex-col justify-end bg-black/20">
        <div className="space-y-0.5 rounded-t-lg bg-background p-1">
          {["Copy", "Add to Reading List"].map((t) => (
            <div key={t} className="rounded bg-muted px-1 py-0.5 text-[5px]">{t}</div>
          ))}
          <div className={cn("flex items-center justify-between rounded bg-muted px-1 py-0.5 text-[5px] font-semibold", HIGHLIGHT)}>
            Add to Home Screen
            <Plus className="size-1.5" />
          </div>
        </div>
      </div>
    </Device>
  );
}

function AppTile({ name, iconUrl, className }: { name: string; iconUrl?: string | null; className?: string }) {
  return iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={iconUrl} alt="" className={cn("size-4 rounded-[4px] bg-white object-cover", className)} />
  ) : (
    <span className={cn("flex size-4 items-center justify-center rounded-[4px] bg-primary text-[6px] font-bold text-primary-foreground", className)}>
      {(name[0] ?? "D").toUpperCase()}
    </span>
  );
}

function MiniHomeScreen({ name, iconUrl, android = false }: { name: string; iconUrl?: string | null; android?: boolean }) {
  return (
    <Device>
      <div
        className="grid h-full grid-cols-3 content-start gap-1 p-1.5"
        style={{ background: android ? "linear-gradient(170deg,#1f4f5a,#9fc7a8)" : "linear-gradient(165deg,#4f6fd0,#e39aa3)" }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} className="size-4 rounded-[4px] bg-white/35" />
        ))}
        <span className={cn("flex flex-col items-center", HIGHLIGHT, "rounded-[5px]")}>
          <AppTile name={name} iconUrl={iconUrl} className={android ? "rounded-full" : undefined} />
        </span>
      </div>
    </Device>
  );
}

function MiniPermission({ os, name }: { os: "ios" | "android"; name: string }) {
  return (
    <Device>
      <div className="flex h-full items-center justify-center bg-black/30 p-1">
        <div className={cn("w-full bg-background p-1 text-center", os === "ios" ? "rounded-md" : "rounded-lg text-left")}>
          <Bell className={cn("size-2 text-primary", os === "ios" ? "mx-auto" : "")} />
          <p className="mt-0.5 text-[5px] font-semibold">
            {os === "ios" ? `"${name}" would like to send you notifications` : `Allow ${name} to send you notifications?`}
          </p>
          <div className={cn("mt-1 flex text-[5px]", os === "ios" ? "border-t" : "justify-end gap-1")}>
            <span className={cn("flex-1 py-0.5 text-muted-foreground", os === "android" && "flex-none")}>Don&apos;t allow</span>
            <span className={cn("flex-1 rounded py-0.5 font-semibold text-primary", os === "android" && "flex-none px-0.5", HIGHLIGHT)}>
              Allow
            </span>
          </div>
        </div>
      </div>
    </Device>
  );
}

function MiniToggleRow({ label }: { label: string }) {
  return (
    <div className="w-[120px] space-y-1 rounded-lg bg-background p-1.5 text-[7px]">
      <p className="font-semibold">Notifications</p>
      <div className={cn("flex items-center justify-between rounded-md bg-muted px-1.5 py-1", HIGHLIGHT)}>
        <span className="truncate">{label}</span>
        <span className="flex h-2.5 w-4 items-center justify-end rounded-full bg-emerald-500 px-px">
          <span className="size-2 rounded-full bg-white" />
        </span>
      </div>
      <div className="h-1.5 w-2/3 rounded-full bg-muted" />
    </div>
  );
}

function MiniChromeMobileBar({ host }: { host: string }) {
  return (
    <Device>
      <div className="flex h-full flex-col">
        <div className={cn("m-1 flex items-center gap-0.5 rounded-full bg-muted px-1 py-0.5", HIGHLIGHT)}>
          <Lock className="size-1.5 shrink-0" />
          <span className="truncate text-[5px]">{host}</span>
        </div>
        <div className="flex-1 space-y-1 p-1.5">
          <div className="h-1.5 w-3/4 rounded-full bg-muted" />
          <div className="h-8 rounded bg-muted/70" />
        </div>
      </div>
    </Device>
  );
}

function MiniChromeMenu({ item }: { item: string }) {
  return (
    <Device>
      <div className="relative h-full">
        <div className="flex items-center justify-between p-1">
          <span className="h-1.5 w-8 rounded-full bg-muted" />
          <MoreVertical className="size-2 text-primary" />
        </div>
        <div className="absolute right-0.5 top-3 w-[44px] space-y-0.5 rounded-md bg-background p-0.5 shadow ring-1 ring-black/10">
          {["New tab", "History", "Downloads"].map((t) => (
            <div key={t} className="px-0.5 text-[5px] text-muted-foreground">{t}</div>
          ))}
          <div className={cn("flex items-center gap-0.5 rounded px-0.5 text-[5px] font-semibold", HIGHLIGHT)}>
            <Download className="size-1.5" />
            {item}
          </div>
        </div>
      </div>
    </Device>
  );
}

function MiniDesktopBar({ host, highlightInstall = false }: { host: string; highlightInstall?: boolean }) {
  return (
    <Device wide>
      <div className="flex items-center gap-1 border-b bg-muted/60 px-1 py-1">
        <span className="flex gap-0.5">
          <span className="size-1 rounded-full bg-red-400" />
          <span className="size-1 rounded-full bg-amber-400" />
          <span className="size-1 rounded-full bg-emerald-400" />
        </span>
        <div className={cn("flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-background px-1 py-0.5", !highlightInstall && HIGHLIGHT)}>
          <Search className="size-1.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[5px]">{host}</span>
          <span className={cn("ml-auto rounded-sm p-px text-primary", highlightInstall && HIGHLIGHT)}>
            <Download className="size-1.5" />
          </span>
        </div>
        <Globe className="size-1.5 text-muted-foreground" />
      </div>
      <div className="space-y-1 p-1.5">
        <div className="h-1.5 w-1/2 rounded-full bg-muted" />
        <div className="h-6 rounded bg-muted/70" />
      </div>
    </Device>
  );
}

function MiniDesktopPermission() {
  return (
    <Device wide>
      <div className="flex items-center gap-1 border-b bg-muted/60 px-1 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-background px-1 py-0.5">
          <Lock className="size-1.5 text-muted-foreground" />
          <span className="h-1 w-10 rounded-full bg-muted" />
        </div>
      </div>
      <div className="p-1.5">
        <div className="w-[88px] rounded-md bg-background p-1 shadow ring-1 ring-black/10">
          <p className="flex items-center gap-0.5 text-[5px] font-semibold">
            <Bell className="size-1.5" /> Show notifications
          </p>
          <div className="mt-1 flex justify-end gap-1 text-[5px]">
            <span className="rounded px-1 py-0.5 text-muted-foreground ring-1 ring-border">Block</span>
            <span className={cn("rounded bg-primary px-1 py-0.5 text-primary-foreground", HIGHLIGHT)}>Allow</span>
          </div>
        </div>
      </div>
    </Device>
  );
}

function MiniToast({ name }: { name: string }) {
  // A Chrome window: the Send test button highlighted on the page, and the
  // test alert arriving in the corner of the screen.
  return (
    <Device wide>
      <div className="flex items-center gap-1 border-b bg-muted/60 px-1 py-1">
        <span className="flex gap-0.5">
          <span className="size-1 rounded-full bg-red-400" />
          <span className="size-1 rounded-full bg-amber-400" />
          <span className="size-1 rounded-full bg-emerald-400" />
        </span>
        <span className="h-1.5 flex-1 rounded-full bg-background" />
      </div>
      <div className="relative h-[66px] p-1.5">
        <div className="h-1 w-1/2 rounded-full bg-muted" />
        <div className="mt-1 h-1 w-1/3 rounded-full bg-muted" />
        <span className={cn("mt-1.5 inline-flex items-center gap-0.5 rounded-full border bg-background px-1 py-0.5 text-[5px] font-medium", HIGHLIGHT)}>
          <Send className="size-1.5" />
          Send test
        </span>
        <div className="absolute right-1 top-1 w-[64px] rounded-md bg-background p-1 shadow-md ring-1 ring-black/10">
          <p className="flex items-center gap-0.5 text-[5px] font-semibold">
            <Bell className="size-1.5 text-primary" />
            {name}
          </p>
          <p className="mt-px text-[5px] text-muted-foreground">Test notification</p>
          <p className="text-[4.5px] text-muted-foreground">If you can see this, push works.</p>
        </div>
      </div>
    </Device>
  );
}
