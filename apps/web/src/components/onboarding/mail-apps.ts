/**
 * "Open Gmail" / "Open Outlook" under the code boxes, on phones.
 *
 * The code screen is where phone signups were lost: they left to find the
 * email and never came back. These buttons open the mail app itself, and the
 * signup tab is never navigated away from, so switching back lands on the code
 * boxes (and a reload or a closed tab is covered by pending-verify.ts).
 *
 * How each is opened:
 *   - iOS: the app's URL scheme (`googlegmail://`, `ms-outlook://`).
 *   - Android: an `intent:` URL for the app's package, which Chrome hands to the
 *     app (or to the Play Store when it is not installed) without leaving the page.
 *   - Anything else, or when the app did not take over within a moment: the web
 *     inbox in a NEW tab.
 * Whether a phone has the app installed cannot be read from a web page, so the
 * fallback is decided by whether the page was hidden shortly after the attempt.
 */

export type MailProvider = "gmail" | "outlook";

export const MAIL_WEB_URL: Record<MailProvider, string> = {
  gmail: "https://mail.google.com/",
  outlook: "https://outlook.live.com/mail/",
};

const IOS_SCHEME: Record<MailProvider, string> = {
  gmail: "googlegmail://",
  outlook: "ms-outlook://",
};

const ANDROID_PACKAGE: Record<MailProvider, string> = {
  gmail: "com.google.android.gm",
  outlook: "com.microsoft.office.outlook",
};

export type MailPlatform = "ios" | "android" | "other";

export function mailPlatform(userAgent: string, maxTouchPoints = 0, platform = ""): MailPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return "ios";
  // iPadOS reports itself as a Mac; a Mac does not have a touch screen.
  if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

/** The URL that hands over to the app on this platform, or null for the web inbox. */
export function mailAppUrl(provider: MailProvider, os: MailPlatform): string | null {
  if (os === "ios") return IOS_SCHEME[provider];
  if (os === "android") {
    return `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${ANDROID_PACKAGE[provider]};end`;
  }
  return null;
}

/** How long to wait for the app to take over before opening the web inbox. */
const APP_HANDOFF_MS = 1500;

/** Call from a click handler. Never navigates the signup tab to the web inbox. */
export function openMailApp(provider: MailProvider): void {
  if (typeof window === "undefined") return;
  const web = MAIL_WEB_URL[provider];
  const os = mailPlatform(navigator.userAgent, navigator.maxTouchPoints, navigator.platform);
  const app = mailAppUrl(provider, os);
  if (!app) {
    window.open(web, "_blank", "noopener,noreferrer");
    return;
  }

  let left = false;
  const onHide = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("blur", onHide);

  // A custom scheme or intent never unloads the page: it either hands over to
  // the app or does nothing.
  window.location.href = app;

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("blur", onHide);
    if (left || document.visibilityState === "hidden") return;
    window.open(web, "_blank", "noopener,noreferrer");
  }, APP_HANDOFF_MS);
}
