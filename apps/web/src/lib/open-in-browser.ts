/**
 * Leaving the Facebook / Instagram app for the phone's real browser (Neema,
 * 2026-11-26).
 *
 * Those apps open links in their own browser, and in there Apple Pay and Google
 * Pay never show: on iPhone the app injects its own scripts into every page,
 * which makes WebKit switch Apple Pay off; on Android it is a WebView, which
 * has no Google Pay. The same page in Safari or Chrome shows both. So the card
 * step offers to carry the signup over, and these helpers build the link that
 * asks the phone to open it there.
 *
 *   iPhone   x-safari-https://…  Safari's own scheme (iOS 17 and later).
 *   Android  intent://…#Intent;…;package=com.android.chrome;…  Chrome, with the
 *            plain link as the fallback when Chrome is not installed.
 *
 * Neither is guaranteed: an app can refuse to hand a link over. The card step
 * therefore also tells people how to do it from the app's own menu, which opens
 * whatever address the page shows, so the page puts the link in the address
 * bar first (`showInAddressBar`).
 */

export type PhonePlatform = "ios" | "android" | "other";

export function phonePlatform(
  ua: string | undefined = typeof navigator !== "undefined" ? navigator.userAgent : "",
): PhonePlatform {
  const s = ua ?? "";
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Android/i.test(s)) return "android";
  return "other";
}

/** The browser people know on this phone: what the button says. */
export function browserName(platform: PhonePlatform): string {
  return platform === "android" ? "Chrome" : "Safari";
}

/** The wallet that browser shows. */
export function walletName(platform: PhonePlatform): string {
  return platform === "android" ? "Google Pay" : "Apple Pay";
}

/** The app's name as people say it. */
export function appName(app: string | null): string {
  switch (app) {
    case "instagram":
      return "Instagram";
    case "messenger":
      return "Messenger";
    case "tiktok":
      return "TikTok";
    default:
      return "Facebook";
  }
}

/** `/?signup=finish&t=…&via=app` on this page's own address. */
export function handoffLink(token: string, origin: string = window.location.origin): string {
  const url = new URL("/", origin);
  url.searchParams.set("signup", "finish");
  url.searchParams.set("t", token);
  url.searchParams.set("via", "app");
  return url.toString();
}

/** The link that asks the phone to open `link` in its real browser. */
export function externalBrowserLink(link: string, platform: PhonePlatform): string {
  const url = new URL(link);
  if (platform === "ios") return `x-safari-${url.protocol.replace(":", "")}://${url.host}${url.pathname}${url.search}`;
  if (platform === "android") {
    return (
      `intent://${url.host}${url.pathname}${url.search}` +
      `#Intent;scheme=${url.protocol.replace(":", "")};package=com.android.chrome;` +
      `S.browser_fallback_url=${encodeURIComponent(link)};end`
    );
  }
  return link;
}

/**
 * Put `link` in the address bar without loading it, so the app's own "Open in
 * external browser" menu opens the signup, not the bare home page.
 */
export function showInAddressBar(link: string): void {
  try {
    const url = new URL(link);
    if (url.origin !== window.location.origin) return;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  } catch {
    /* nothing to do: the copy button still has the link */
  }
}

/** Copy to the clipboard; false when the app's browser will not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
