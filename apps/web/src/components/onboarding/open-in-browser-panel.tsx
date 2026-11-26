"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";

import { captureSignup } from "@/lib/analytics";
import {
  appName,
  browserName,
  copyText,
  externalBrowserLink,
  phonePlatform,
  showInAddressBar,
  walletName,
  type PhonePlatform,
} from "@/lib/open-in-browser";
import { cn } from "@/lib/utils";

import { useOnboardingShell } from "./onboarding-provider";
import { SIGNUP_ENTER, SIGNUP_HIT, SIGNUP_QUIET } from "./signup-ui";

type State = "idle" | "making" | "opened" | "failed";

/**
 * "Pay with Apple Pay in Safari", on the card step, only inside the Facebook,
 * Instagram, Messenger or TikTok app (Neema, 2026-11-26: "We are losing
 * customers there"). Those apps open links in their own browser, where Apple
 * Pay and Google Pay never show. One tap makes a 2-hour link to this signup and
 * asks the phone to open it in Safari (Chrome on Android), where they land back
 * on this step, signed in, with the wallet button. The card form below still
 * works for anyone who would rather type a card here.
 *
 * Opening another browser is up to the app, so when the phone stays put the
 * panel shows how to do it from the app's own menu (which opens the address on
 * screen, so the link is put there first) and offers to copy the link.
 */
export function OpenInBrowserPanel() {
  const { inAppBrowser, makeBrowserHandoffLink } = useOnboardingShell();
  // `inAppBrowser` is only set after mount (the server has no user agent), so
  // reading the platform here never differs between server and browser.
  const platform: PhonePlatform = inAppBrowser ? phonePlatform() : "other";

  const [state, setState] = useState<State>("idle");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  const browser = browserName(platform);
  const wallet = walletName(platform);
  const app = appName(inAppBrowser);

  async function open() {
    setState("making");
    setCopied(null);
    captureSignup("browser_handoff_tapped", { app: inAppBrowser, platform });
    const made = link ?? (await makeBrowserHandoffLink());
    if (!made) {
      setState("failed");
      return;
    }
    setLink(made);
    showInAddressBar(made);
    // The menu steps show at once: someone whose phone switched to the other
    // browser never sees them, and someone whose app kept the link needs them.
    setState("opened");
    window.location.href = externalBrowserLink(made, platform);
  }

  async function copy() {
    if (!link) return;
    setCopied(await copyText(link));
  }

  const menuSteps =
    platform === "android"
      ? `If ${browser} did not open, tap ⋮ at the top right, then Open in Chrome.`
      : `If ${browser} did not open, tap ••• at the top right, then Open in external browser.`;

  if (!inAppBrowser || platform === "other") return null;

  return (
    <div
      className={cn("rounded-2xl border border-zinc-200 px-4 py-4 dark:border-white/10", SIGNUP_ENTER)}
      data-testid="open-in-browser"
    >
      <p className="text-sm font-semibold text-foreground">Want to pay with {wallet}?</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {wallet} doesn&apos;t work inside the {app} app. Open this page in {browser} and you&apos;ll be
        right back on this step, signed in, with {wallet} ready.
      </p>

      <button
        type="button"
        onClick={() => void open()}
        disabled={state === "making"}
        className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-black text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {state === "making" ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
        Open in {browser}
      </button>

      {state === "failed" && (
        <p className={cn("mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400", SIGNUP_ENTER)} role="status">
          We couldn&apos;t open {browser} just now. Try again, or enter your card below.
        </p>
      )}

      {state === "opened" && link && (
        <div className={cn("mt-3 space-y-2", SIGNUP_ENTER)}>
          <p className="text-xs leading-relaxed text-muted-foreground">{menuSteps}</p>
          <button type="button" onClick={() => void copy()} className={cn(SIGNUP_QUIET, SIGNUP_HIT, "inline-flex items-center gap-1.5 text-xs underline")}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? `Copied. Paste it into ${browser}.` : "Copy the link instead"}
          </button>
          {copied === false && (
            <p className="text-xs text-muted-foreground">
              Copying is blocked here. Use the menu steps above instead.
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">Or enter your card below.</p>
    </div>
  );
}
