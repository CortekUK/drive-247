/**
 * Notifications v2 previews (components/settings-v2/notifications-v2/):
 *   - EmailPreviewGmail: the exact HTML in a sandboxed iframe (never
 *     allow-scripts), Gmail's header, the Desktop / Phone width switch, the
 *     auto height and the swallowed link clicks.
 *   - PushPreviewPhone: the iPhone and Android mockups, how each part is
 *     clamped per device, the phone-style last line, and the "Open in app"
 *     button only on Android.
 *   - InAppPreview: the team (portal bell) and customer (booking bell) rows.
 *
 * Nothing here touches Supabase: the three components are pure UI. jsdom has
 * no layout, so the measuring paths are fed fake documents and fake ranges.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  EmailPreviewGmail,
  GMAIL_CLIP_BYTES,
  GMAIL_PREVIEW_CAPTION,
  GMAIL_PREVIEW_VIEWS,
  emailByteSize,
  fitScale,
  letterTileColor,
  letterTileInitial,
  measureEmailDocumentHeight,
} from "@/components/settings-v2/notifications-v2/email-preview-gmail";
import {
  PUSH_OPEN_IN_APP_LABEL,
  PUSH_PREVIEW_CAPTION,
  PUSH_PREVIEW_NOTES,
  PUSH_PREVIEW_PROFILES,
  PushPreviewPhone,
  pushClampStyle,
  splitForPhone,
  type PushPreviewProfile,
} from "@/components/settings-v2/notifications-v2/push-preview-phone";
import { IN_APP_CAPTIONS, IN_APP_TIME_LABEL, InAppPreview } from "@/components/settings-v2/notifications-v2/inapp-preview";
import { PUSH_DEVICE_PROFILES } from "@/lib/notifications-v2/push-display";
import { CATEGORY_LABEL } from "@/components/notifications/taxonomy";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

const HTML =
  '<!DOCTYPE html><html><body><table role="presentation"><tr><td><p>Hi Jo, your booking is confirmed. <a href="https://example.com/b/1">View booking</a></p></td></tr></table></body></html>';

function renderEmail(props: Partial<Parameters<typeof EmailPreviewGmail>[0]> = {}) {
  return render(
    <EmailPreviewGmail
      subject="Your booking is confirmed"
      html={HTML}
      fromName="Northwind Rentals"
      fromAddress="northwind@drive-247.com"
      toAddress="jo@example.com"
      sentAtLabel="9:41 AM (0 minutes ago)"
      {...props}
    />,
  );
}

const frameOf = (container: HTMLElement) => container.querySelector("iframe") as HTMLIFrameElement;

/** A stand-in for the iframe's document: jsdom does no layout. */
function fakeEmailDocument(height: number) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const doc = {
    body: { scrollHeight: height, firstElementChild: {}, getBoundingClientRect: () => ({ bottom: 0 }) },
    defaultView: null,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    removeEventListener: vi.fn(),
  };
  return { doc, listeners };
}

describe("EmailPreviewGmail", () => {
  it("puts the exact HTML in a sandboxed iframe that can never run scripts", () => {
    const { container } = renderEmail();
    const iframe = frameOf(container);
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("srcdoc")).toBe(HTML);
    const sandbox = (iframe.getAttribute("sandbox") ?? "").trim().split(/\s+/);
    expect(sandbox).toEqual(["allow-same-origin"]);
    expect(sandbox).not.toContain("allow-scripts");
    expect(iframe.getAttribute("scrolling")).toBe("no");
    expect(iframe.getAttribute("title")).toContain("Your booking is confirmed");
  });

  it("shows Gmail's header: subject, sender name, <address>, time and 'to me'", () => {
    renderEmail();
    expect(screen.getByText("Your booking is confirmed")).toBeInTheDocument();
    expect(screen.getByText("Northwind Rentals")).toBeInTheDocument();
    expect(screen.getByText("<northwind@drive-247.com>")).toBeInTheDocument();
    expect(screen.getByText("9:41 AM (0 minutes ago)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /to me/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(GMAIL_PREVIEW_CAPTION)).toBeInTheDocument();
  });

  it("'to me' opens the details with the recipient, like Gmail's", () => {
    const { container } = renderEmail();
    expect(container.textContent).not.toContain("jo@example.com");
    fireEvent.click(screen.getByRole("button", { name: /to me/i }));
    expect(screen.getByRole("button", { name: /to me/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("jo@example.com")).toBeInTheDocument();
    expect(container.querySelector("[data-gmail-details]")?.textContent).toContain("subject:");
  });

  it("falls back like Gmail: '(no subject)', and the address as the name", () => {
    renderEmail({ subject: "  ", fromName: "" });
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
    expect(screen.getByText("northwind@drive-247.com")).toBeInTheDocument();
  });

  it("switches the body between Gmail's desktop and phone widths", () => {
    const { container } = renderEmail();
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure).toHaveAttribute("data-view", "desktop");
    expect(frameOf(container).style.width).toBe(`${GMAIL_PREVIEW_VIEWS.desktop.bodyWidth}px`);
    expect(screen.getByRole("radio", { name: "Desktop" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Phone" }));
    expect(screen.getByRole("radio", { name: "Phone" })).toHaveAttribute("aria-checked", "true");
    expect(figure).toHaveAttribute("data-view", "phone");
    expect(frameOf(container).style.width).toBe(`${GMAIL_PREVIEW_VIEWS.phone.bodyWidth}px`);
    // The same HTML, still sandboxed, after the move.
    expect(frameOf(container).getAttribute("srcdoc")).toBe(HTML);
    expect(frameOf(container).getAttribute("sandbox")).toBe("allow-same-origin");

    // Arrow keys move through the switch too.
    fireEvent.keyDown(screen.getByRole("radio", { name: "Phone" }), { key: "ArrowLeft" });
    expect(figure).toHaveAttribute("data-view", "desktop");
  });

  it("opens at the phone width when asked", () => {
    const { container } = renderEmail({ defaultView: "phone" });
    expect(frameOf(container).style.width).toBe(`${GMAIL_PREVIEW_VIEWS.phone.bodyWidth}px`);
  });

  it("sizes the frame to the email's height on load, and shrinks for a shorter one", () => {
    const { container } = renderEmail();
    const iframe = frameOf(container);
    const tall = fakeEmailDocument(912);
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => tall.doc });
    fireEvent.load(iframe);
    expect(iframe.style.height).toBe("912px");

    const short = fakeEmailDocument(420);
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => short.doc });
    fireEvent.load(iframe);
    expect(iframe.style.height).toBe("420px");
  });

  it("swallows clicks on links inside the email, so the preview can't navigate away", () => {
    const { container } = renderEmail();
    const iframe = frameOf(container);
    const { doc, listeners } = fakeEmailDocument(600);
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => doc });
    fireEvent.load(iframe);
    expect(typeof listeners.click).toBe("function");

    const onLink = vi.fn();
    listeners.click({ target: { closest: (s: string) => (s === "a[href]" ? {} : null) }, preventDefault: onLink });
    expect(onLink).toHaveBeenCalledTimes(1);

    const onText = vi.fn();
    listeners.click({ target: { closest: () => null }, preventDefault: onText });
    expect(onText).not.toHaveBeenCalled();
  });

  it("shows a plain message instead of an empty frame when there is no HTML", () => {
    const { container } = renderEmail({ html: "  " });
    expect(frameOf(container)).toBeNull();
    expect(screen.getByText("This email has no message yet.")).toBeInTheDocument();
  });

  it("warns when Gmail would clip the email", () => {
    const { container, rerender } = renderEmail();
    expect(container.textContent).not.toContain("102 KB");
    const big = HTML.replace("</p>", `${"x".repeat(GMAIL_CLIP_BYTES)}</p>`);
    rerender(
      <EmailPreviewGmail
        subject="Big"
        html={big}
        fromName="Northwind Rentals"
        fromAddress="northwind@drive-247.com"
        toAddress="jo@example.com"
      />,
    );
    expect(screen.getByRole("note").textContent).toContain("102 KB");
  });
});

describe("email preview helpers", () => {
  it("measures the body, and reports 0 before the email has loaded", () => {
    expect(measureEmailDocumentHeight(null)).toBe(0);
    // about:blank: a body with nothing in it.
    expect(measureEmailDocumentHeight({ body: { firstElementChild: null, scrollHeight: 8 } } as unknown as Document)).toBe(0);
    expect(
      measureEmailDocumentHeight({
        body: { firstElementChild: {}, scrollHeight: 300, getBoundingClientRect: () => ({ bottom: 310.2 }) },
        defaultView: { getComputedStyle: () => ({ marginBottom: "4px" }) },
      } as unknown as Document),
    ).toBe(315);
  });

  it("gives each sender a stable letter tile", () => {
    expect(letterTileColor("Northwind Rentals")).toBe(letterTileColor("  northwind rentals "));
    expect(letterTileColor("Northwind Rentals")).toMatch(/^#[0-9a-f]{6}$/);
    expect(letterTileInitial("  northwind")).toBe("N");
    expect(letterTileInitial('"Élan" Cars')).toBe("É");
    expect(letterTileInitial("247 Cars")).toBe("2");
    expect(letterTileInitial("")).toBe("?");
  });

  it("scales a mockup down only when the column is narrower than it", () => {
    expect(fitScale(0, 800)).toBe(1);
    expect(fitScale(1200, 800)).toBe(1);
    expect(fitScale(400, 800)).toBe(0.5);
  });

  it("counts bytes the way Gmail's clip limit does", () => {
    expect(emailByteSize("abc")).toBe(3);
    expect(emailByteSize("é")).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

// The lead's example (transcript §3.9): the title is cut mid-word.
const LONG_TITLE = "My name is Ghulam Muhyuddin, my name is Ghulam";
const BODY =
  "Your booking for the Toyota Corolla from 12 Oct to 15 Oct is confirmed. We will send the pickup details and the lockbox code the day before.";

const partOf = (container: HTMLElement, device: string, part: string) =>
  container.querySelector(`[data-push-mockup="${device}"] [data-push-part="${part}"]`) as HTMLElement | null;

describe("PushPreviewPhone", () => {
  it("draws the iPhone lock screen by default: one-line title, four-line message", () => {
    const { container } = render(<PushPreviewPhone title={LONG_TITLE} body={BODY} appName="Northwind" />);
    const iphone = PUSH_PREVIEW_PROFILES.iphone;
    const title = partOf(container, "iphone", "title")!;
    const body = partOf(container, "iphone", "body")!;
    expect(title).toHaveAttribute("data-max-lines", String(iphone.title.maxLines.collapsed));
    expect(title).toHaveAttribute("data-clamp", "single");
    expect(title.textContent).toBe(LONG_TITLE);
    // The title shares its row with "now".
    expect(title.style.width).toBe(`${iphone.contentWidth - iphone.titleReserve}px`);
    expect(body).toHaveAttribute("data-max-lines", String(iphone.body.maxLines.collapsed));
    expect(body.style.width).toBe(`${iphone.contentWidth}px`);
    expect((body.firstElementChild as HTMLElement).textContent).toBe(BODY);
    expect(container.textContent).toContain("now");
    expect(screen.getByText(PUSH_PREVIEW_CAPTION)).toBeInTheDocument();
  });

  it("clamps one line with nowrap + ellipsis (mid-word) and more with line-clamp", () => {
    expect(pushClampStyle(1)).toMatchObject({ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" });
    expect(pushClampStyle(4)).toMatchObject({
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: 4,
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    expect(pushClampStyle(7).WebkitLineClamp).toBe(7);
  });

  it("switches to Android: one-line message collapsed, seven lines expanded", () => {
    const { container } = render(<PushPreviewPhone title={LONG_TITLE} body={BODY} appName="Northwind" />);
    fireEvent.click(screen.getByRole("radio", { name: "Android" }));
    const android = PUSH_PREVIEW_PROFILES.android;
    const mockup = container.querySelector('[data-push-mockup="android"]')!;
    expect(mockup).toHaveAttribute("data-android-state", "collapsed");
    expect(partOf(container, "android", "title")).toHaveAttribute("data-max-lines", "1");
    expect(partOf(container, "android", "body")).toHaveAttribute("data-max-lines", String(android.body.maxLines.collapsed));
    expect(partOf(container, "android", "body")).toHaveAttribute("data-clamp", "single");
    expect(container.textContent).toContain("Northwind • now");

    fireEvent.click(screen.getByRole("radio", { name: "Expanded" }));
    expect(container.querySelector('[data-push-mockup="android"]')).toHaveAttribute("data-android-state", "expanded");
    expect(partOf(container, "android", "body")).toHaveAttribute("data-max-lines", String(android.body.maxLines.expanded));
    expect(partOf(container, "android", "body")?.style.width).toBe(`${android.contentWidth}px`);
  });

  it("shows the Open in app button only on Android, and says iPhone has none", () => {
    const { container } = render(
      <PushPreviewPhone title="Booking confirmed" body={BODY} appName="Northwind" options={{ openInApp: true }} />,
    );
    expect(container.querySelector("[data-push-action]")).toBeNull();
    expect(screen.getByText(PUSH_PREVIEW_NOTES.openInAppIphone)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Android" }));
    const action = container.querySelector('[data-push-mockup="android"] [data-push-action="open-in-app"]');
    expect(action?.textContent).toBe(PUSH_OPEN_IN_APP_LABEL);
    expect(screen.getByText(PUSH_PREVIEW_NOTES.openInAppAndroid)).toBeInTheDocument();
  });

  it("has no Open in app button on Android when the option is off", () => {
    const { container } = render(<PushPreviewPhone title="Booking confirmed" body={BODY} appName="Northwind" device="android" />);
    expect(container.querySelector('[data-push-mockup="android"]')).not.toBeNull();
    expect(container.querySelector("[data-push-action]")).toBeNull();
    expect(container.textContent).not.toContain(PUSH_OPEN_IN_APP_LABEL);
  });

  it("notes what the display options change", () => {
    render(
      <PushPreviewPhone
        title="Booking confirmed"
        body={BODY}
        appName="Northwind"
        options={{ requireInteraction: true, silent: true, replacePrevious: true }}
      />,
    );
    expect(screen.getByText(PUSH_PREVIEW_NOTES.requireInteraction)).toBeInTheDocument();
    expect(screen.getByText(PUSH_PREVIEW_NOTES.silent)).toBeInTheDocument();
    expect(screen.getByText(PUSH_PREVIEW_NOTES.replacePrevious)).toBeInTheDocument();
  });

  it("is one labelled image for screen readers, with the whole text", () => {
    render(<PushPreviewPhone title={LONG_TITLE} body={BODY} appName="Northwind" />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("iPhone");
    expect(label).toContain("Northwind");
    expect(label).toContain(LONG_TITLE);
    expect(label).toContain(BODY);
  });

  it("uses the app name as the iPhone title when there is none", () => {
    const { container } = render(<PushPreviewPhone title="" body={BODY} appName="Northwind" />);
    expect(partOf(container, "iphone", "title")?.textContent).toBe("Northwind");
  });

  it("follows the device prop and reports changes", () => {
    const onDeviceChange = vi.fn();
    const { container, rerender } = render(
      <PushPreviewPhone title="T" body="B" appName="Northwind" device="android" onDeviceChange={onDeviceChange} />,
    );
    expect(container.querySelector('[data-push-mockup="android"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "iPhone" }));
    expect(onDeviceChange).toHaveBeenCalledWith("iphone");
    expect(container.querySelector('[data-push-mockup="iphone"]')).not.toBeNull();
    rerender(<PushPreviewPhone title="T" body="B" appName="Northwind" device="iphone" />);
    rerender(<PushPreviewPhone title="T" body="B" appName="Northwind" device="android" />);
    expect(container.querySelector('[data-push-mockup="android"]')).not.toBeNull();
  });

  it("draws at the sizes it is given", () => {
    const narrow: PushPreviewProfile = { ...PUSH_PREVIEW_PROFILES.iphone, contentWidth: 250 };
    const { container } = render(<PushPreviewPhone title="T" body={BODY} appName="Northwind" profiles={{ iphone: narrow }} />);
    expect(partOf(container, "iphone", "body")?.style.width).toBe("250px");
  });

  it("draws the tenant icon, and a letter tile when it fails to load", () => {
    const { container } = render(
      <PushPreviewPhone title="T" body="B" appName="Northwind" iconUrl="https://cdn.example.com/logo.png" />,
    );
    const img = container.querySelector('[data-push-mockup="iphone"] img') as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(img);
    expect(container.querySelector('[data-push-mockup="iphone"] img')).toBeNull();
    expect(container.querySelector("[data-push-icon-fallback]")?.textContent).toBe("N");
  });

  it("keeps the same device sizes as push-display.ts", () => {
    for (const device of ["iphone", "android"] as const) {
      const mine = PUSH_PREVIEW_PROFILES[device];
      // Assigning checks at compile time that push-display's profile fits this prop.
      const theirs: PushPreviewProfile = PUSH_DEVICE_PROFILES[device];
      expect(drawn(mine)).toEqual(drawn(theirs));
    }
  });
});

/** The fields the mockups draw with. */
function drawn(p: PushPreviewProfile) {
  const style = (s: PushPreviewProfile["title"]) => ({
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    maxLines: s.maxLines,
  });
  return {
    screenWidth: p.screenWidth,
    cardWidth: p.cardWidth,
    contentWidth: p.contentWidth,
    titleReserve: p.titleReserve,
    iconSize: p.iconSize,
    cardRadius: p.cardRadius,
    fontFamily: p.fontFamily,
    title: style(p.title),
    body: style(p.body),
  };
}

/**
 * A fake measurer: `perLine` characters on each 20px line (scaled by `scale`),
 * the way a range over the hidden copy reports it in the browser.
 */
function fakeMeasurer(text: string, perLine: number, scale = 1) {
  let start = 0;
  const range = {
    setStart: (_node: unknown, index: number) => {
      start = index;
    },
    setEnd: () => undefined,
    getBoundingClientRect: () => {
      const line = Math.floor(start / perLine);
      return { top: (line * 20 + 2) * scale, bottom: (line * 20 + 18) * scale, width: 8 * scale, height: 16 * scale };
    },
  };
  return {
    range,
    el: {
      firstChild: { nodeType: 3, length: text.length },
      ownerDocument: { createRange: () => range },
      getBoundingClientRect: () => ({ top: 0, height: 1000 * scale }),
      offsetHeight: 1000,
    } as unknown as HTMLElement,
  };
}

describe("splitForPhone (the phone-style last line)", () => {
  it("keeps the lines before the last and starts the last line where the browser wrapped", () => {
    // 18 per line: "My name is Ghulam " | "Muhyuddin, my name" | " is Ghulam"
    const { el } = fakeMeasurer(LONG_TITLE, 18);
    expect(splitForPhone(el, LONG_TITLE, 2, 20)).toEqual({ head: "My name is Ghulam", tail: "Muhyuddin, my name is Ghulam" });
  });

  it("works the same on a scaled-down mockup", () => {
    const { el } = fakeMeasurer(LONG_TITLE, 18, 0.5);
    expect(splitForPhone(el, LONG_TITLE, 2, 20)).toEqual({ head: "My name is Ghulam", tail: "Muhyuddin, my name is Ghulam" });
  });

  it("returns null when the text fits, for one line, or when nothing can be measured", () => {
    const { el } = fakeMeasurer(LONG_TITLE, 18);
    expect(splitForPhone(el, LONG_TITLE, 3, 20)).toBeNull();
    expect(splitForPhone(el, LONG_TITLE, 1, 20)).toBeNull();
    expect(splitForPhone(null, LONG_TITLE, 2, 20)).toBeNull();
    const noRects = {
      firstChild: { nodeType: 3, length: LONG_TITLE.length },
      ownerDocument: { createRange: () => ({ setStart() {}, setEnd() {} }) },
      getBoundingClientRect: () => ({ top: 0, height: 0 }),
      offsetHeight: 0,
    } as unknown as HTMLElement;
    expect(splitForPhone(noRects, LONG_TITLE, 2, 20)).toBeNull();
  });

  it("draws the iPhone message as kept lines plus one cut last line once measured", () => {
    // 30 per line, 4 lines shown: the last line starts at the first word of line 4.
    const { range } = fakeMeasurer(BODY, 30);
    vi.spyOn(document, "createRange").mockImplementation(() => range as unknown as Range);
    const { container } = render(<PushPreviewPhone title="Booking confirmed" body={BODY} appName="Northwind" />);
    const body = partOf(container, "iphone", "body")!;
    expect(body).toHaveAttribute("data-clamp", "split");
    const [head, last] = Array.from(body.children) as HTMLElement[];
    expect(head.textContent).toBe(BODY.slice(0, 90).trimEnd());
    expect(last.textContent).toBe(BODY.slice(90));
    expect(BODY.startsWith(`${head.textContent}`)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* In-app                                                                      */
/* -------------------------------------------------------------------------- */

describe("InAppPreview", () => {
  it("team: a row of the portal's notification centre", () => {
    const { container } = render(
      <InAppPreview audience="team" title="New booking" body="Jo Bloggs booked the Corolla for 12 Oct." bellCategory="rentals" />,
    );
    expect(container.querySelector('[data-inapp-mockup="team"]')).not.toBeNull();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("New booking")).toBeInTheDocument();
    expect(screen.getByText("Jo Bloggs booked the Corolla for 12 Oct.")).toBeInTheDocument();
    expect(screen.getByText(IN_APP_TIME_LABEL)).toBeInTheDocument();
    expect(screen.getByText(CATEGORY_LABEL.rentals)).toBeInTheDocument();
    expect(container.querySelector("[data-inapp-unread]")).not.toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("New booking");
    expect(screen.getByText(IN_APP_CAPTIONS.team)).toBeInTheDocument();
  });

  it("team: an empty title reads 'Notification', as the portal prints it", () => {
    render(<InAppPreview audience="team" title="  " body="Something happened." />);
    expect(screen.getByText("Notification")).toBeInTheDocument();
  });

  it("customer: a row of the booking site's bell popover", () => {
    const { container } = render(
      <InAppPreview audience="customer" title="Booking approved" body="Your booking is confirmed." companyName="Northwind" />,
    );
    expect(container.querySelector('[data-inapp-mockup="customer"]')).not.toBeNull();
    expect(container.querySelector('[data-inapp-mockup="team"]')).toBeNull();
    expect(screen.getByText("Northwind")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Booking approved")).toBeInTheDocument();
    expect(screen.getByText("Your booking is confirmed.")).toBeInTheDocument();
    expect(screen.getByText(IN_APP_TIME_LABEL)).toBeInTheDocument();
    expect(screen.getByText("View all notifications")).toBeInTheDocument();
    expect(screen.getByText(IN_APP_CAPTIONS.customer)).toBeInTheDocument();
  });

  it("says where a click on the row goes", () => {
    const { container, rerender } = render(<InAppPreview audience="team" title="New booking" body="B" />);
    expect(container.textContent).not.toContain("Opens");
    rerender(<InAppPreview audience="team" title="New booking" body="B" link="/rentals/123" />);
    expect(screen.getByText("/rentals/123")).toBeInTheDocument();
    expect(container.textContent).toContain("Opens /rentals/123 when clicked.");
  });
});
