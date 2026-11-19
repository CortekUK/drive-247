// =============================================================================
// Drive247's own emails to operators (welcome, onboarding call), in one design.
//
// The same look as the signup code email (_shared/signup-otp.ts): the Drive247
// logo above a white card on a pale page, a dark palette for mail apps that
// honour `prefers-color-scheme` (and Outlook.com's `[data-ogsc]`), and inline
// light styles as the default because some clients strip <style>. Table layout,
// no flex/grid, no gradients or shadows, so Gmail and Outlook draw it as built.
//
// Every value put in here is HTML already: callers escape what users typed with
// `escapeHtml` below.
// =============================================================================

const LOGO_LIGHT = "https://www.drive-247.com/logo-light.png";
const LOGO_DARK = "https://www.drive-247.com/logo-dark.png";
const FONT = "'DM Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const ACCENT = "#4f46e5";
export const SUPPORT_EMAIL = "support@drive-247.com";

/**
 * Who Drive247's own emails come from. Not noreply@: these emails invite a
 * reply, and replies must reach a person.
 */
export const DRIVE247_SENDER = { from: SUPPORT_EMAIL, fromName: "Drive247", replyTo: SUPPORT_EMAIL } as const;

/**
 * The logo <img> attributes. When a mail app blocks images (Outlook does until
 * the sender is trusted) the alt text is drawn instead, so it is styled to read
 * as the wordmark rather than as a broken image.
 */
const LOGO_ALT_STYLE = `font-family:${"'DM Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"};font-size:24px;line-height:30px;font-weight:700;color:#4f46e5;`;
export function logoImgs(): string {
  return `<img class="l-logo" src="${LOGO_LIGHT}" width="132" height="30" alt="Drive247" style="display:block;border:0;width:132px;height:auto;${LOGO_ALT_STYLE}">
            <img class="d-logo" src="${LOGO_DARK}" width="132" height="30" alt="Drive247" style="border:0;width:132px;height:auto;${LOGO_ALT_STYLE}">`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface Drive247Email {
  /** Inbox preview line, plain text. */
  preheader: string;
  /** Small coloured line above the title. */
  eyebrow?: string;
  title?: string;
  /** Paragraphs under the title (HTML). */
  intro?: string[];
  /** A ready-made block of body HTML (with inline styles), after the intro. */
  bodyHtml?: string;
  /** The main button. */
  cta?: { label: string; href: string };
  /** A second, outlined button beside the main one. */
  secondaryCta?: { label: string; href: string };
  /** A highlighted callout box after the steps (title + HTML text + optional link). */
  callout?: { title: string; text: string; link?: { label: string; href: string } };
  /** A boxed list of label / value rows (values are HTML). */
  details?: { heading?: string; rows: Array<{ label: string; value: string }> };
  /** A numbered "what next" list (HTML items). */
  steps?: { heading: string; items: string[] };
  /** Small print at the bottom of the card (HTML). */
  note?: string;
}

/** Drive247-branded email HTML. */
export function renderDrive247Email(e: Drive247Email): string {
  const intro = (e.intro ?? [])
    .map((p) => `<p class="d-body" style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4a4a5c;">${p}</p>`)
    .join("");

  const cta = e.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 4px;">
        <tr><td bgcolor="${ACCENT}" style="background-color:${ACCENT};border-radius:10px;">
          <a href="${e.cta.href}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">${e.cta.label}</a>
        </td>${
          e.secondaryCta
            ? `<td style="width:10px;font-size:0;">&nbsp;</td>
        <td class="d-box" style="border:1px solid #d9d9e6;border-radius:10px;background:#ffffff;">
          <a href="${e.secondaryCta.href}" class="d-link" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${ACCENT};text-decoration:none;border-radius:10px;">${e.secondaryCta.label}</a>
        </td>`
            : ""
        }</tr>
      </table>`
    : "";

  const callout = e.callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-num" style="margin:24px 0 0;background:#eef2ff;border-radius:12px;">
        <tr><td style="padding:18px 20px;font-family:${FONT};">
          <p class="d-ink" style="margin:0 0 6px;font-size:15px;font-weight:600;color:#0b0b1a;">${e.callout.title}</p>
          <p class="d-body" style="margin:0;font-size:14px;line-height:1.55;color:#4a4a5c;">${e.callout.text}</p>
          ${e.callout.link ? `<p style="margin:10px 0 0;font-size:14px;"><a href="${e.callout.link.href}" class="d-link" style="color:${ACCENT};font-weight:600;text-decoration:none;">${e.callout.link.label} &rarr;</a></p>` : ""}
        </td></tr>
      </table>`
    : "";

  const details = e.details
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-box" style="margin:26px 0 0;background:#f7f7fb;border:1px solid #ececf3;border-radius:12px;">
        ${e.details.heading ? `<tr><td colspan="2" class="d-muted" style="padding:16px 18px 4px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#7a7a8c;">${e.details.heading}</td></tr>` : ""}
        ${e.details.rows
          .map(
            (r, i) => `<tr>
          <td class="d-muted" style="padding:${i === 0 && !e.details!.heading ? 16 : 8}px 0 8px 18px;font-family:${FONT};font-size:13px;line-height:1.5;color:#7a7a8c;width:120px;vertical-align:top;">${r.label}</td>
          <td class="d-ink" style="padding:${i === 0 && !e.details!.heading ? 16 : 8}px 18px 8px 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:#0b0b1a;word-break:break-all;">${r.value}</td>
        </tr>`,
          )
          .join("")}
        <tr><td colspan="2" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
      </table>`
    : "";

  const steps = e.steps
    ? `<p class="d-ink" style="margin:28px 0 12px;font-family:${FONT};font-size:15px;font-weight:600;color:#0b0b1a;">${e.steps.heading}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${e.steps.items
          .map(
            (item, i) => `<tr>
          <td style="width:34px;padding:0 0 12px;vertical-align:top;">
            <div class="d-num" style="width:24px;height:24px;border-radius:12px;background:#eef2ff;color:${ACCENT};font-family:${FONT};font-size:12px;font-weight:700;line-height:24px;text-align:center;">${i + 1}</div>
          </td>
          <td class="d-body" style="padding:2px 0 12px;font-family:${FONT};font-size:14px;line-height:1.55;color:#4a4a5c;">${item}</td>
        </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const note = e.note
    ? `<hr class="d-rule" style="border:0;border-top:1px solid #ececf3;margin:26px 0 18px;">
      <p class="d-muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#7a7a8c;">${e.note}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e.title ?? "Drive247"}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .d-logo { display:none; max-height:0; overflow:hidden; mso-hide:all; }
  @media (prefers-color-scheme: dark) {
    .d-page { background:#0e0e16 !important; }
    .d-card { background:#16161f !important; border-color:#262633 !important; }
    .d-box { background:#1c1c27 !important; border-color:#2a2a38 !important; }
    .d-ink { color:#ededf3 !important; }
    .d-body { color:#b4b4c4 !important; }
    .d-muted { color:#8a8aa0 !important; }
    .d-num { background:#1c1a3d !important; color:#c7d2fe !important; }
    .d-link { color:#a5b4fc !important; }
    .d-rule { border-color:#262633 !important; }
    .l-logo { display:none !important; max-height:0 !important; }
    .d-logo { display:block !important; max-height:none !important; overflow:visible !important; }
  }
  [data-ogsc] .d-page { background:#0e0e16 !important; }
  [data-ogsc] .d-card { background:#16161f !important; border-color:#262633 !important; }
  [data-ogsc] .d-box { background:#1c1c27 !important; border-color:#2a2a38 !important; }
  [data-ogsc] .d-ink { color:#ededf3 !important; }
  [data-ogsc] .d-body { color:#b4b4c4 !important; }
  [data-ogsc] .d-muted { color:#8a8aa0 !important; }
  [data-ogsc] .d-link { color:#a5b4fc !important; }
  [data-ogsc] .l-logo { display:none !important; }
  [data-ogsc] .d-logo { display:block !important; max-height:none !important; }
</style>
</head>
<body class="d-page" style="margin:0;padding:0;background:#f4f4f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${e.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-page" style="background:#f4f4f8;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td align="center" style="padding:0 0 24px;">
            ${logoImgs()}
          </td>
        </tr>
        <tr>
          <td class="d-card" style="background:#ffffff;border:1px solid #e8e8f0;border-radius:16px;padding:36px 32px;font-family:${FONT};">
            ${e.eyebrow ? `<p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${ACCENT};" class="d-link">${e.eyebrow}</p>` : ""}
            ${e.title ? `<h1 class="d-ink" style="margin:0 0 14px;font-size:24px;line-height:1.3;font-weight:600;color:#0b0b1a;">${e.title}</h1>` : ""}
            ${intro}
            ${e.bodyHtml ?? ""}
            ${cta}
            ${details}
            ${steps}
            ${callout}
            ${note}
          </td>
        </tr>
        <tr>
          <td align="center" class="d-muted" style="padding:20px 0 0;font-family:${FONT};font-size:12px;line-height:1.7;color:#9a9aac;">
            Questions? Write to us at <a href="mailto:${SUPPORT_EMAIL}" class="d-muted" style="color:#9a9aac;">${SUPPORT_EMAIL}</a><br>
            Drive247 · <a href="https://www.drive-247.com" class="d-muted" style="color:#9a9aac;text-decoration:none;">drive-247.com</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A link styled for the email body. */
export function emailLink(href: string, text: string): string {
  return `<a href="${href}" class="d-link" style="color:${ACCENT};font-weight:600;text-decoration:none;">${text}</a>`;
}
