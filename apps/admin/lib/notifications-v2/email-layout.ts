/**
 * Notifications v2: the email layout.
 *
 * ONE module builds the HTML of every notification email, for both sides:
 *   - the portal preview (apps/portal/src/lib/notifications-v2/email-layout.ts)
 *   - the edge function notification-test-v2
 *     (supabase/functions/_shared/notification-email-layout-v2.ts)
 * The two files are byte-identical, and a test fails when they drift. That is
 * how "the preview shows exactly what the test send delivers" (build-spec D15)
 * stays true. Edit one, then copy it over the other.
 *
 * Rules for this file, because it runs in the browser AND in Deno:
 *   - no imports, no Node / DOM / Deno-only APIs (no DOMParser, no Buffer);
 *   - it must type-check under strict TypeScript (Deno is strict).
 *
 * Gmail-safe by construction (Gmail drops <style> in many cases and ignores
 * gradients, shadows, CSS variables, flex and grid):
 *   - a table-based layout, 600px wide, every style inline;
 *   - flat colours set twice, as a `bgcolor` attribute and `background-color`;
 *   - no <style> block, no gradients, no box-shadow, no var(--...);
 *   - a web-safe font stack.
 *
 * Pipeline: renderNotificationEmailHtml() = sanitizeEmailBodyHtml()
 * -> inlineEmailStyles() -> the branded frame. Callers fill {{variables}}
 * BEFORE calling it (with HTML-escaped values), so the sanitiser also checks
 * the filled links.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A local copy of `EmailBrand` from ./types.ts (structurally identical). It is
 * repeated here because this file may not import anything.
 */
export interface EmailLayoutBrand {
  companyName: string;
  logoUrl?: string | null;
  /** Header background, #rrggbb. */
  primaryColor?: string | null;
  /** Buttons and links, #rrggbb. */
  accentColor?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface RenderNotificationEmailInput {
  /** The template body (editor HTML), with variables already filled. */
  bodyHtml: string;
  brand: EmailLayoutBrand | null | undefined;
  /** Hidden preview text that inbox lists show next to the subject. */
  preheader?: string | null;
  /**
   * The logo's real size in pixels, when known. With it the <img> gets exact
   * width and height attributes; without it only the height is fixed and the
   * width follows the image, so a logo is never stretched.
   */
  logoWidth?: number | null;
  logoHeight?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Drive247's defaults, the same as `wrapEmailHtml` in _shared/email-template-service.ts. */
export const EMAIL_LAYOUT_DEFAULTS = {
  companyName: "Drive247",
  primaryColor: "#1a1a1a",
  accentColor: "#c5a572",
} as const;

/** Content width of the email, in px. */
export const EMAIL_LAYOUT_WIDTH = 600;

/** Web-safe stack: system UI fonts first, then Helvetica / Arial everywhere else. */
export const EMAIL_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const COLORS = {
  page: "#f4f4f5",
  card: "#ffffff",
  border: "#e4e4e7",
  heading: "#18181b",
  text: "#3f3f46",
  quote: "#52525b",
  quoteBg: "#fafafa",
  muted: "#71717a",
  footerBg: "#fafafa",
  footerText: "#52525b",
  rule: "#e4e4e7",
  fallbackLink: "#1d4ed8",
  dark: "#111111",
  light: "#ffffff",
} as const;

const LOGO_MAX_HEIGHT = 48;
const LOGO_MAX_WIDTH = 200;

/* -------------------------------------------------------------------------- */
/* Escaping                                                                    */
/* -------------------------------------------------------------------------- */

/** Escapes text for HTML element content and double-quoted attributes. */
export function escapeEmailHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes a value that goes inside a double-quoted attribute (keeps ' as is). */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Text between tags: keeps entity references that are already there (&amp;,
 * &#39;, &nbsp;), escapes a bare & and any < or >.
 */
function escapeText(value: string): string {
  return value
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{0,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
  period: ".",
  lpar: "(",
  rpar: ")",
};

/** Decodes the entities that matter in URLs. Anything unknown is left as written. */
function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (match: string, ref: string) => {
    if (ref.charAt(0) === "#") {
      const hex = ref.charAt(1) === "x" || ref.charAt(1) === "X";
      const code = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!isFinite(code) || code < 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/* -------------------------------------------------------------------------- */
/* Colours                                                                     */
/* -------------------------------------------------------------------------- */

/** "#abc" or "#aabbcc" (any case) -> "#aabbcc". Anything else -> null. */
export function normaliseHexColor(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v);
  if (short) return ("#" + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  return null;
}

/** WCAG 2.x relative luminance of a #rrggbb colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const c = normaliseHexColor(hex) ?? "#000000";
  const channel = (i: number): number => {
    const s = parseInt(c.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `background`. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, COLORS.light) >= contrastRatio(background, COLORS.dark)
    ? COLORS.light
    : COLORS.dark;
}

interface ResolvedBrand {
  companyName: string;
  logoUrl: string | null;
  primary: string;
  accent: string;
  onPrimary: string;
  /** Link colour on the white card. */
  link: string;
  /** Button background and text. */
  button: string;
  onButton: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

const EMAIL_ADDRESS = /^[^\s@<>"'(),;:\\[\]]+@[^\s@<>"'(),;:\\[\]]+\.[^\s@<>"'(),;:\\[\]]+$/;

function safeImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : null;
}

function resolveBrand(brand: EmailLayoutBrand | null | undefined): ResolvedBrand {
  const b: Partial<EmailLayoutBrand> = brand ?? {};
  const companyName =
    typeof b.companyName === "string" && b.companyName.trim() ? b.companyName.trim() : EMAIL_LAYOUT_DEFAULTS.companyName;
  const primary = normaliseHexColor(b.primaryColor) ?? EMAIL_LAYOUT_DEFAULTS.primaryColor;
  const accent = normaliseHexColor(b.accentColor) ?? EMAIL_LAYOUT_DEFAULTS.accentColor;

  // Links sit on white and are underlined, so 3:1 is the bar (WCAG's non-text
  // contrast). A pale accent such as the default gold falls back to the primary
  // colour, then to a plain link blue.
  let link: string = COLORS.fallbackLink;
  if (contrastRatio(accent, COLORS.card) >= 3) link = accent;
  else if (contrastRatio(primary, COLORS.card) >= 3) link = primary;

  // A button must stand out from the white card; a near-white accent would vanish.
  let button: string = accent;
  if (contrastRatio(accent, COLORS.card) < 1.5) {
    button = contrastRatio(primary, COLORS.card) >= 1.5 ? primary : COLORS.heading;
  }

  const email = typeof b.contactEmail === "string" ? b.contactEmail.trim() : "";
  const phone = typeof b.contactPhone === "string" ? b.contactPhone.trim() : "";

  return {
    companyName,
    logoUrl: safeImageUrl(b.logoUrl),
    primary,
    accent,
    onPrimary: readableTextColor(primary),
    link,
    button,
    onButton: readableTextColor(button),
    contactEmail: email && EMAIL_ADDRESS.test(email) ? email : null,
    contactPhone: phone || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Sanitiser                                                                   */
/* -------------------------------------------------------------------------- */

const ALLOWED_TAGS: Record<string, true> = {
  p: true,
  br: true,
  h1: true,
  h2: true,
  h3: true,
  strong: true,
  b: true,
  em: true,
  i: true,
  u: true,
  s: true,
  ul: true,
  ol: true,
  li: true,
  a: true,
  blockquote: true,
  hr: true,
  span: true,
};

const VOID_TAGS: Record<string, true> = { br: true, hr: true };

/** Tags whose CONTENT is dropped too (not just the tag). */
const DROP_CONTENT_TAGS: Record<string, true> = {
  script: true,
  style: true,
  iframe: true,
  frame: true,
  frameset: true,
  object: true,
  embed: true,
  applet: true,
  noscript: true,
  noembed: true,
  noframes: true,
  template: true,
  textarea: true,
  title: true,
  xmp: true,
  plaintext: true,
  svg: true,
  math: true,
  select: true,
  head: true,
};

/** Opening one of these closes an open <p>, as a browser does. */
const CLOSES_P: Record<string, true> = {
  p: true,
  h1: true,
  h2: true,
  h3: true,
  ul: true,
  ol: true,
  blockquote: true,
  hr: true,
};

const HEADINGS: Record<string, true> = { h1: true, h2: true, h3: true };

const VARIABLE_ONLY = /^\{\{[A-Za-z0-9_]+\}\}/;
const SAFE_DATA_VALUE = /^[A-Za-z0-9_-]{0,64}$/;

/** A link a customer can safely click: http(s), mailto, or a {{variable}} filled later. */
function safeHref(raw: string): string | null {
  // Browsers ignore ASCII tab / newline inside URLs and trim spaces and
  // control characters at the ends, so do the same before checking.
  const v = decodeEntities(raw)
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  if (/^https?:\/\/[^\s/?#]+/i.test(v)) return v;
  if (/^mailto:[^\s]+$/i.test(v)) return v;
  if (VARIABLE_ONLY.test(v) && !/[\s"'<>]/.test(v)) return v;
  return null;
}

interface ParsedTag {
  name: string;
  attrs: Array<[string, string]>;
  /** Index just past the closing ">". */
  end: number;
}

/**
 * Reads a start tag the way a browser's tokenizer does: the name runs until
 * whitespace, "/" or ">"; attribute values may be quoted (and then contain ">")
 * or unquoted. Returns null when the tag never closes (the rest is dropped).
 */
function readStartTag(html: string, start: number): ParsedTag | null {
  const n = html.length;
  let i = start + 1;
  let name = "";
  while (i < n && !/[\s/>]/.test(html.charAt(i))) {
    name += html.charAt(i);
    i++;
  }
  const attrs: Array<[string, string]> = [];
  for (;;) {
    while (i < n && /[\s/]/.test(html.charAt(i))) i++;
    if (i >= n) return null;
    if (html.charAt(i) === ">") return { name: name.toLowerCase(), attrs, end: i + 1 };

    let attrName = html.charAt(i);
    i++;
    while (i < n && !/[\s/>=]/.test(html.charAt(i))) {
      attrName += html.charAt(i);
      i++;
    }
    while (i < n && /\s/.test(html.charAt(i))) i++;
    let value = "";
    if (html.charAt(i) === "=") {
      i++;
      while (i < n && /\s/.test(html.charAt(i))) i++;
      const q = html.charAt(i);
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close === -1) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        while (i < n && !/[\s>]/.test(html.charAt(i))) {
          value += html.charAt(i);
          i++;
        }
      }
    }
    attrs.push([attrName.toLowerCase(), value]);
  }
}

/** Index just past the end tag `</name ...>`, or -1 when there is none. `lower` is `html` lower-cased. */
function findEndOf(html: string, lower: string, name: string, from: number): number {
  let i = from;
  for (;;) {
    const at = lower.indexOf("</" + name, i);
    if (at === -1) return -1;
    const after = lower.charAt(at + 2 + name.length);
    if (after === "" || after === ">" || after === "/" || /\s/.test(after)) {
      const close = html.indexOf(">", at);
      return close === -1 ? -1 : close + 1;
    }
    i = at + 2;
  }
}

function buildAttrs(name: string, attrs: Array<[string, string]>): string {
  const seen: Record<string, true> = {};
  let href: string | null = null;
  let button: string | null = null;
  let variable: string | null = null;
  for (const [key, value] of attrs) {
    if (seen[key]) continue; // the first one wins, as in a browser
    seen[key] = true;
    if (name === "a" && key === "href") href = safeHref(value);
    else if (name === "a" && key === "data-email-button") button = SAFE_DATA_VALUE.test(value) ? value : "";
    else if ((name === "span" || name === "a") && key === "data-variable") {
      const v = value.trim();
      if (/^[A-Za-z0-9_]{1,64}$/.test(v)) variable = v;
    }
  }
  let out = "";
  if (href !== null) out += ' href="' + escapeAttr(href) + '"';
  if (button !== null) out += ' data-email-button="' + escapeAttr(button) + '"';
  if (variable !== null) out += ' data-variable="' + variable + '"';
  return out;
}

/**
 * Keeps only the tags and attributes the editor produces and drops the rest:
 *   tags        p, br, h1-h3, strong, b, em, i, u, s, ul, ol, li, a,
 *               blockquote, hr, span (anything else is unwrapped: its text stays)
 *   attributes  href on <a> (http, https, mailto or a {{variable}}),
 *               data-email-button on <a>, data-variable on <span> / <a>
 *   removed     comments, <script>/<style>/<iframe>/... with their content,
 *               on* handlers, style, class, javascript: and data: links
 * The output is well formed (every open tag is closed) and sanitising it again
 * returns the same string. Tokenizer based: no DOMParser, so it runs in Deno.
 */
export function sanitizeEmailBodyHtml(html: string | null | undefined): string {
  const src = String(html ?? "");
  const lower = src.toLowerCase();
  const n = src.length;
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  let text = "";

  const flushText = (): void => {
    if (text) {
      out.push(escapeText(text));
      text = "";
    }
  };
  const closeTo = (index: number): void => {
    while (stack.length > index) out.push("</" + stack.pop() + ">");
  };
  const lastIndexOf = (name: string, stopAt?: Record<string, true>): number => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k] === name) return k;
      if (stopAt && stopAt[stack[k]]) return -1;
    }
    return -1;
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      text += src.slice(i);
      break;
    }
    text += src.slice(i, lt);
    const next = src.charAt(lt + 1);

    // Comments, <!doctype>, <![CDATA[...]]>, <?xml ...?>: dropped.
    if (next === "!" || next === "?") {
      if (src.startsWith("<!--", lt)) {
        const close = src.indexOf("-->", lt + 4);
        i = close === -1 ? n : close + 3;
      } else {
        const close = src.indexOf(">", lt + 2);
        i = close === -1 ? n : close + 1;
      }
      continue;
    }

    // End tag.
    if (next === "/") {
      const m = /^<\/([a-zA-Z][^\s/>]*)/.exec(src.slice(lt, lt + 80));
      if (!m) {
        // "</" not followed by a letter: a browser drops it as a bogus comment.
        const close = src.indexOf(">", lt + 2);
        i = close === -1 ? n : close + 1;
        continue;
      }
      const close = src.indexOf(">", lt);
      i = close === -1 ? n : close + 1;
      const name = m[1].toLowerCase();
      if (ALLOWED_TAGS[name] && !VOID_TAGS[name]) {
        const at = lastIndexOf(name);
        if (at !== -1) {
          flushText();
          closeTo(at);
        }
      }
      continue;
    }

    // Start tag.
    if (/[a-zA-Z]/.test(next)) {
      const tag = readStartTag(src, lt);
      if (!tag) {
        i = n; // an unterminated tag swallows the rest, as in a browser
        break;
      }
      i = tag.end;
      const name = tag.name;
      if (DROP_CONTENT_TAGS[name]) {
        const end = findEndOf(src, lower, name, i);
        i = end === -1 ? n : end;
        continue;
      }
      if (!ALLOWED_TAGS[name]) continue; // unwrap: the tag goes, its text stays

      flushText();
      if (CLOSES_P[name]) {
        const p = lastIndexOf("p");
        if (p !== -1) closeTo(p);
      }
      if (HEADINGS[name] && stack.length && HEADINGS[stack[stack.length - 1]]) closeTo(stack.length - 1);
      if (name === "li") {
        const li = lastIndexOf("li", { ul: true, ol: true });
        if (li !== -1) closeTo(li);
      }
      if (name === "a") {
        const a = lastIndexOf("a");
        if (a !== -1) closeTo(a);
      }
      out.push("<" + name + buildAttrs(name, tag.attrs) + ">");
      if (!VOID_TAGS[name]) stack.push(name);
      continue;
    }

    // A "<" that starts no tag is text.
    text += "<";
    i = lt + 1;
  }

  flushText();
  closeTo(0);
  return out.join("");
}

/* -------------------------------------------------------------------------- */
/* Inline styles                                                               */
/* -------------------------------------------------------------------------- */

interface Token {
  kind: "text" | "start" | "end" | "comment";
  raw: string;
  name: string;
  attrs: string;
}

const TAG_TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  TAG_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_TOKEN.exec(html)) !== null) {
    if (m.index > last) tokens.push({ kind: "text", raw: html.slice(last, m.index), name: "", attrs: "" });
    if (m[2] === undefined) {
      tokens.push({ kind: "comment", raw: m[0], name: "", attrs: "" });
    } else {
      tokens.push({
        kind: m[1] ? "end" : "start",
        raw: m[0],
        name: m[2].toLowerCase(),
        attrs: m[3] ?? "",
      });
    }
    last = TAG_TOKEN.lastIndex;
  }
  if (last < html.length) tokens.push({ kind: "text", raw: html.slice(last), name: "", attrs: "" });
  return tokens;
}

function hasAttr(attrs: string, name: string): boolean {
  return new RegExp("(^|[\\s\"'])" + name + "(\\s*=|[\\s/]|$)", "i").test(attrs);
}

function withoutAttr(attrs: string, name: string): string {
  return attrs.replace(new RegExp("\\s" + name + "(\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]*))?", "gi"), "");
}

function addStyle(name: string, attrs: string, css: string, extra = ""): string {
  const selfClosing = /\/\s*$/.test(attrs);
  const base = selfClosing ? attrs.replace(/\/\s*$/, "") : attrs;
  return "<" + name + base.replace(/\s+$/, "") + extra + ' style="' + css + '"' + (selfClosing ? " /" : "") + ">";
}

function styleFor(name: string, parent: string | undefined, brand: ResolvedBrand): string | null {
  const font = "font-family:" + EMAIL_FONT_STACK + ";";
  const inList = parent === "li";
  const inQuote = parent === "blockquote";
  switch (name) {
    case "p":
      if (inList) return "margin:0;";
      if (inQuote) return "margin:0 0 8px;font-size:15px;line-height:24px;color:" + COLORS.quote + ";" + font;
      return "margin:0 0 16px;font-size:15px;line-height:24px;color:" + COLORS.text + ";" + font;
    case "h1":
      return "margin:0 0 16px;font-size:24px;line-height:32px;font-weight:700;color:" + COLORS.heading + ";" + font;
    case "h2":
      return "margin:24px 0 12px;font-size:20px;line-height:28px;font-weight:700;color:" + COLORS.heading + ";" + font;
    case "h3":
      return "margin:20px 0 8px;font-size:16px;line-height:24px;font-weight:700;color:" + COLORS.heading + ";" + font;
    case "ul":
    case "ol":
      return (
        (inList ? "margin:6px 0 0;" : "margin:0 0 16px;") +
        "padding:0 0 0 24px;font-size:15px;line-height:24px;color:" +
        COLORS.text +
        ";" +
        font
      );
    case "li":
      return "margin:0 0 6px;";
    case "a":
      return "color:" + brand.link + ";text-decoration:underline;";
    case "blockquote":
      return (
        "margin:0 0 16px;padding:12px 16px;border-left:4px solid " +
        brand.accent +
        ";background-color:" +
        COLORS.quoteBg +
        ";color:" +
        COLORS.quote +
        ";" +
        font
      );
    case "hr":
      return "border:0;border-top:1px solid " + COLORS.rule + ";height:0;margin:24px 0;";
    default:
      return null;
  }
}

function buttonHtml(attrs: string, label: string, brand: ResolvedBrand, block: boolean): string {
  const hrefMatch = /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(" " + attrs);
  const href = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? "") : "";
  const hrefAttr = hrefMatch ? ' href="' + escapeAttr(decodeEntities(href)) + '" target="_blank"' : "";
  // Inside running text the padding is smaller, so the button does not run
  // into the lines above and below it.
  const linkStyle =
    "display:inline-block;padding:" +
    (block ? "12px 24px" : "4px 12px") +
    ";font-family:" +
    EMAIL_FONT_STACK +
    ";font-size:15px;font-weight:600;line-height:20px;color:" +
    brand.onButton +
    ";text-decoration:none;border-radius:" +
    (block ? "8px" : "6px") +
    ";";
  if (!block) {
    return (
      "<a" +
      hrefAttr +
      ' style="' +
      linkStyle +
      "background-color:" +
      brand.button +
      ';">' +
      label +
      "</a>"
    );
  }
  return (
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-collapse:separate;">' +
    '<tr><td align="center" bgcolor="' +
    brand.button +
    '" style="background-color:' +
    brand.button +
    ';border-radius:8px;">' +
    "<a" +
    hrefAttr +
    ' style="' +
    linkStyle +
    '">' +
    label +
    "</a></td></tr></table>"
  );
}

interface OpenEl {
  name: string;
  /** Index of its start tag in `out`. */
  at: number;
  hasContent: boolean;
}

/**
 * Adds inline styles to p, h1-h3, ul, ol, li, a, blockquote and hr (skipping any
 * element that already has a style attribute), and turns `<a data-email-button>`
 * into a button: a table cell with bgcolor around a padded link when the button
 * stands on its own line, or a padded inline link inside running text.
 * Expects sanitised HTML; unknown markup is passed through untouched.
 */
export function inlineEmailStyles(bodyHtml: string | null | undefined, brand: EmailLayoutBrand | null | undefined): string {
  const b = resolveBrand(brand);
  const tokens = tokenize(String(bodyHtml ?? ""));
  const out: string[] = [];
  const stack: OpenEl[] = [];
  const markContent = (): void => {
    if (stack.length) stack[stack.length - 1].hasContent = true;
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === "text") {
      if (t.raw.trim()) markContent();
      out.push(t.raw);
      continue;
    }
    if (t.kind === "comment") {
      out.push(t.raw);
      continue;
    }
    if (t.kind === "end") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === t.name) {
          stack.length = s;
          break;
        }
      }
      out.push(t.raw);
      continue;
    }

    // Start tag.
    const parent = stack.length ? stack[stack.length - 1] : undefined;

    if (t.name === "a" && hasAttr(t.attrs, "data-email-button")) {
      let close = -1;
      for (let j = k + 1; j < tokens.length; j++) {
        if (tokens[j].kind === "end" && tokens[j].name === "a") {
          close = j;
          break;
        }
      }
      const endAt = close === -1 ? tokens.length : close;
      const label = tokens
        .slice(k + 1, endAt)
        .map((x) => x.raw)
        .join("");

      // Alone in its paragraph or list item? Then it is a block button.
      let soleIn: OpenEl | undefined;
      let skipTo = endAt;
      if (parent && (parent.name === "p" || parent.name === "li") && !parent.hasContent) {
        let j = endAt + 1;
        while (j < tokens.length && tokens[j].kind === "text" && !tokens[j].raw.trim()) j++;
        if (j < tokens.length && tokens[j].kind === "end" && tokens[j].name === parent.name) {
          soleIn = parent;
          if (parent.name === "p") skipTo = j; // the <p> wrapper goes, see below
        }
      }
      const block = !parent || parent.name === "blockquote" || soleIn !== undefined;
      if (soleIn && soleIn.name === "p") {
        out[soleIn.at] = "";
        stack.pop();
      } else {
        markContent();
      }
      out.push(buttonHtml(withoutAttr(t.attrs, "data-email-button"), label, b, block));
      k = skipTo;
      continue;
    }

    markContent();
    const css = hasAttr(t.attrs, "style") ? null : styleFor(t.name, parent?.name, b);
    let raw = t.raw;
    if (css !== null) {
      const extra = t.name === "a" && !hasAttr(t.attrs, "target") && hasAttr(t.attrs, "href") ? ' target="_blank"' : "";
      raw = addStyle(t.name, t.attrs, css, extra);
    }
    out.push(raw);
    if (t.name !== "br" && t.name !== "hr" && !/\/\s*$/.test(t.attrs)) {
      stack.push({ name: t.name, at: out.length - 1, hasContent: false });
    }
  }
  return out.join("");
}

/* -------------------------------------------------------------------------- */
/* The frame                                                                   */
/* -------------------------------------------------------------------------- */

function logoHtml(b: ResolvedBrand, width?: number | null, height?: number | null): string {
  if (!b.logoUrl) {
    return (
      '<span style="font-family:' +
      EMAIL_FONT_STACK +
      ";font-size:20px;line-height:28px;font-weight:700;color:" +
      b.onPrimary +
      ';">' +
      escapeEmailHtml(b.companyName) +
      "</span>"
    );
  }
  let size = ' height="' + LOGO_MAX_HEIGHT + '"';
  let css = "height:" + LOGO_MAX_HEIGHT + "px;width:auto;max-width:" + LOGO_MAX_WIDTH + "px;";
  if (width && height && width > 0 && height > 0) {
    const scale = Math.min(LOGO_MAX_HEIGHT / height, LOGO_MAX_WIDTH / width, 1);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    size = ' width="' + w + '" height="' + h + '"';
    css = "width:" + w + "px;height:" + h + "px;";
  }
  return (
    '<img src="' +
    escapeAttr(b.logoUrl) +
    '" alt="' +
    escapeEmailHtml(b.companyName) +
    '"' +
    size +
    ' border="0" style="display:block;margin:0 auto;' +
    css +
    "border:0;outline:none;text-decoration:none;font-family:" +
    EMAIL_FONT_STACK +
    ";font-size:20px;font-weight:700;color:" +
    b.onPrimary +
    ';">'
  );
}

function footerHtml(b: ResolvedBrand): string {
  const linkStyle = ' style="color:' + COLORS.footerText + ';text-decoration:underline;"';
  const parts: string[] = [];
  if (b.contactEmail) {
    parts.push(
      "Email " +
        '<a href="mailto:' +
        escapeAttr(b.contactEmail) +
        '"' +
        linkStyle +
        ">" +
        escapeEmailHtml(b.contactEmail) +
        "</a>",
    );
  }
  if (b.contactPhone) {
    const digits = b.contactPhone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
    const phone = escapeEmailHtml(b.contactPhone);
    parts.push(
      (parts.length ? "or call " : "Call ") +
        (digits.replace(/\D/g, "").length >= 5 ? '<a href="tel:' + digits + '"' + linkStyle + ">" + phone + "</a>" : phone),
    );
  }
  const contact = parts.length
    ? '<p style="margin:4px 0 0;font-family:' +
      EMAIL_FONT_STACK +
      ";font-size:12px;line-height:18px;color:" +
      COLORS.muted +
      ';">Questions? ' +
      parts.join(" ") +
      ".</p>"
    : "";
  return (
    '<p style="margin:0;font-family:' +
    EMAIL_FONT_STACK +
    ";font-size:13px;line-height:20px;font-weight:600;color:" +
    COLORS.footerText +
    ';">' +
    escapeEmailHtml(b.companyName) +
    "</p>" +
    contact
  );
}

function preheaderHtml(preheader: string | null | undefined): string {
  const text = typeof preheader === "string" ? preheader.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  // The filler stops inbox lists from pulling body text in after the preheader.
  let filler = "";
  for (let k = 0; k < 40; k++) filler += "&#847;&zwnj;&nbsp;";
  return (
    '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:' +
    COLORS.page +
    ';">' +
    escapeEmailHtml(text) +
    filler +
    "</div>"
  );
}

/**
 * The full email document: page background, a header band in the tenant's
 * primary colour with the logo (or the company name), the body card, and a
 * footer with the company's contact details. The body is sanitised and styled
 * here, so the preview and the test send cannot differ.
 */
export function renderNotificationEmailHtml(input: RenderNotificationEmailInput): string {
  const b = resolveBrand(input.brand);
  const body = inlineEmailStyles(sanitizeEmailBodyHtml(input.bodyHtml), input.brand);
  const border = "1px solid " + COLORS.border;
  return [
    "<!DOCTYPE html>",
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    "<title>" + escapeEmailHtml(b.companyName) + "</title>",
    "</head>",
    '<body bgcolor="' + COLORS.page + '" style="margin:0;padding:0;background-color:' + COLORS.page + ';">',
    preheaderHtml(input.preheader),
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="' +
      COLORS.page +
      '" style="width:100%;background-color:' +
      COLORS.page +
      ';">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="' +
      EMAIL_LAYOUT_WIDTH +
      '" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:' +
      EMAIL_LAYOUT_WIDTH +
      'px;border-collapse:separate;">',
    '<tr><td align="center" bgcolor="' +
      b.primary +
      '" style="background-color:' +
      b.primary +
      ';padding:24px 32px;border-radius:12px 12px 0 0;">' +
      logoHtml(b, input.logoWidth, input.logoHeight) +
      "</td></tr>",
    '<tr><td bgcolor="' +
      COLORS.card +
      '" style="background-color:' +
      COLORS.card +
      ";padding:32px;border-left:" +
      border +
      ";border-right:" +
      border +
      ";font-family:" +
      EMAIL_FONT_STACK +
      ";font-size:15px;line-height:24px;color:" +
      COLORS.text +
      ';">' +
      body +
      "</td></tr>",
    '<tr><td align="center" bgcolor="' +
      COLORS.footerBg +
      '" style="background-color:' +
      COLORS.footerBg +
      ";padding:20px 32px;border:" +
      border +
      ';border-radius:0 0 12px 12px;text-align:center;">' +
      footerHtml(b) +
      "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Plain-text part                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A plain-text version of a body, for the text/plain part of the email (mail
 * clients and spam filters like having one). Links become "label (url)".
 */
export function emailBodyToPlainText(bodyHtml: string | null | undefined): string {
  const clean = sanitizeEmailBodyHtml(bodyHtml);
  const withLinks = clean.replace(
    /<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m: string, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, "").trim();
      const url = decodeEntities(href);
      return text && decodeEntities(text) !== url ? text + " (" + url + ")" : url;
    },
  );
  const text = withLinks
    .replace(/<br>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<hr>/gi, "\n\n---\n\n")
    .replace(/<\/(p|h1|h2|h3|blockquote|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
