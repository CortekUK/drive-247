/**
 * "Open Gmail" / "Open Outlook" on the code screen.
 *
 * WHAT THESE PIN: a phone gets the app (iOS scheme, Android intent), anything
 * else gets the web inbox, and the web inbox is the https address named in the
 * brief.
 */

import { describe, expect, it } from "vitest";

import { MAIL_WEB_URL, mailAppUrl, mailPlatform } from "./mail-apps";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("which platform", () => {
  it("tells iPhone, iPad (which says Mac), Android and the rest apart", () => {
    expect(mailPlatform(IPHONE)).toBe("ios");
    expect(mailPlatform(MAC, 5, "MacIntel")).toBe("ios");
    expect(mailPlatform(MAC, 0, "MacIntel")).toBe("other");
    expect(mailPlatform(ANDROID)).toBe("android");
  });
});

describe("where each button goes", () => {
  it("opens the apps on a phone", () => {
    expect(mailAppUrl("gmail", "ios")).toBe("googlegmail://");
    expect(mailAppUrl("outlook", "ios")).toBe("ms-outlook://");
    expect(mailAppUrl("gmail", "android")).toContain("package=com.google.android.gm;");
    expect(mailAppUrl("outlook", "android")).toContain("package=com.microsoft.office.outlook;");
  });

  it("never sends an Android visitor's tab to a fallback page", () => {
    // `S.browser_fallback_url` would navigate THIS tab away from the code.
    expect(mailAppUrl("gmail", "android")).not.toContain("browser_fallback_url");
  });

  it("falls back to the web inboxes", () => {
    expect(mailAppUrl("gmail", "other")).toBeNull();
    expect(MAIL_WEB_URL.gmail).toBe("https://mail.google.com/");
    expect(MAIL_WEB_URL.outlook).toBe("https://outlook.live.com/mail/");
  });
});
