"use client";

/**
 * Notifications v2: the email preview, drawn as Gmail's message view
 * (build-spec D15, transcript §3.8 "the preview must show the email exactly as
 * it will look in Gmail, as the customer will see it").
 *
 * What it shows, around the email itself:
 *   - Desktop: Gmail on the web. The subject at 22px, the sender's letter
 *     avatar, the name in bold with <address> after it, "to me ▾" (which opens
 *     the from / to / date / subject details, as Gmail's does), the time on the
 *     right, and the body in a 680px column under the sender name.
 *   - Phone: the Gmail app. Its top bar, the same header stacked for a 360px
 *     screen, and the body across the screen.
 *
 * The email is the caller's `html` (the full document from
 * `renderNotificationEmailHtml`, the same bytes the test send delivers). It is
 * never parsed or rewritten here: it goes into an <iframe srcdoc> with
 * `sandbox="allow-same-origin"` and NEVER `allow-scripts`, so nothing in a
 * template can run. `allow-same-origin` is only there so this component can
 * read the document's height; without scripts it grants the email nothing.
 * The frame grows to the email's height (no inner scrollbar), and a click on a
 * link inside it is swallowed so the preview can't navigate away.
 *
 * Mockups keep Gmail's own light colours in both themes; the controls and the
 * caption around them follow the portal theme. At a narrow width the whole
 * mockup scales down (`FitToWidth`) instead of scrolling sideways.
 *
 * Also exported for the push preview next door: `PreviewSwitch` (the small
 * segmented control), `FitToWidth` and the letter-tile helpers.
 *
 * v2 only: rendered by the v2 Notifications page (northwind canary).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Forward,
  Mail,
  Monitor,
  MoreVertical,
  Printer,
  Reply,
  Smartphone,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

export type GmailPreviewView = "desktop" | "phone";

export interface GmailPreviewViewSpec {
  label: string;
  /** Width of the email body column, CSS px (the iframe's width). */
  bodyWidth: number;
  /** Width of the whole mockup including the grey frame, CSS px. */
  mockupWidth: number;
}

/**
 * Desktop: Gmail's reading pane gives the body about 680px on a laptop, under
 * a 56px avatar gutter. Phone: a 360px screen with 8px either side of the body.
 */
export const GMAIL_PREVIEW_VIEWS: Record<GmailPreviewView, GmailPreviewViewSpec> = {
  desktop: { label: "Desktop", bodyWidth: 680, mockupWidth: 800 },
  phone: { label: "Phone", bodyWidth: 344, mockupWidth: 384 },
};

export const GMAIL_PREVIEW_CAPTION = "How it looks in Gmail. Other email apps may differ slightly.";

/** Gmail cuts a message off after about 102 KB of HTML ("[Message clipped]"). */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/** The height the frame starts at, before the email has loaded. */
export const GMAIL_FRAME_MIN_HEIGHT = 160;

/** Gmail's display face first; it is not downloaded, so a system face stands in. */
export const GMAIL_SUBJECT_FONT =
  '"Google Sans", "Google Sans Text", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
export const GMAIL_UI_FONT =
  '"Google Sans Text", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/** Gmail's own colours. The mockup keeps them in dark mode too. */
const G = {
  frame: "#f6f8fc",
  card: "#ffffff",
  text: "#1f1f1f",
  muted: "#5e5e5e",
  icon: "#444746",
  line: "#e0e0e0",
  chip: "#e8eaed",
  pillBorder: "#747775",
} as const;

/** Letter-avatar colours, all dark enough for a white initial. */
const LETTER_TILE_COLORS = [
  "#1a73e8",
  "#d93025",
  "#188038",
  "#b06000",
  "#9334e6",
  "#d01884",
  "#007b83",
  "#5f6368",
] as const;

/* -------------------------------------------------------------------------- */
/* Small helpers (exported for the other previews and for tests)               */
/* -------------------------------------------------------------------------- */

/** `useLayoutEffect` in the browser, `useEffect` during a server render. */
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** A stable colour for a name's letter tile, the way Gmail colours unknown senders. */
export function letterTileColor(name: string | null | undefined): string {
  const key = String(name ?? "").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return LETTER_TILE_COLORS[hash % LETTER_TILE_COLORS.length];
}

/** The first letter or digit of a name, upper-cased; "?" when there is none. */
export function letterTileInitial(name: string | null | undefined): string {
  const first = Array.from(String(name ?? "")).find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return first ? first.toLocaleUpperCase() : "?";
}

/** Size of the HTML in bytes, as Gmail counts it for clipping. */
export function emailByteSize(html: string | null | undefined): number {
  const text = String(html ?? "");
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

/**
 * The height of an email document's content, in CSS px (0 when there is
 * nothing to measure yet, e.g. the blank page an iframe shows before its
 * srcdoc loads). Uses the body, not the root element: the root is never
 * shorter than the frame, so a frame measured by it could only ever grow.
 */
export function measureEmailDocumentHeight(doc: Document | null | undefined): number {
  const body = doc?.body;
  if (!body || !body.firstElementChild) return 0;
  let height = Number(body.scrollHeight) || 0;
  try {
    const rect = typeof body.getBoundingClientRect === "function" ? body.getBoundingClientRect() : null;
    const style = doc?.defaultView?.getComputedStyle?.(body);
    const marginBottom = style ? parseFloat(style.marginBottom) || 0 : 0;
    if (rect && rect.bottom > 0) height = Math.max(height, rect.bottom + marginBottom);
  } catch {
    /* keep scrollHeight */
  }
  return Math.ceil(height);
}

/** Gmail's date lines for a message that has just arrived, in the viewer's locale. */
export function gmailDateLabels(date: Date): { desktop: string; phone: string; details: string } {
  const format = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch {
      return date.toISOString();
    }
  };
  const time = format({ hour: "numeric", minute: "2-digit" });
  return {
    desktop: `${time} (0 minutes ago)`,
    phone: time,
    details: format({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
  };
}

/**
 * Listens inside the loaded email: swallows link clicks (a click would
 * navigate the frame away from the email), and re-measures when a late image
 * loads or the body resizes. Returns the cleanup.
 */
function watchEmailDocument(iframe: HTMLIFrameElement | null, onChange: () => void): () => void {
  const doc = iframe?.contentDocument;
  if (!doc) return () => {};
  const cleanups: Array<() => void> = [];

  const onClick = (event: Event) => {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (target && typeof target.closest === "function" && target.closest("a[href]")) event.preventDefault();
  };
  const onAsset = () => onChange();
  try {
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("load", onAsset, true);
    doc.addEventListener("error", onAsset, true);
    cleanups.push(() => {
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("load", onAsset, true);
      doc.removeEventListener("error", onAsset, true);
    });
  } catch {
    /* a document we can't listen to still previews */
  }
  try {
    if (typeof ResizeObserver !== "undefined" && doc.body) {
      const observer = new ResizeObserver(() => onChange());
      observer.observe(doc.body);
      cleanups.push(() => observer.disconnect());
    }
  } catch {
    /* no observer: load and width changes still re-measure */
  }
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        /* the document may already be gone */
      }
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Shared UI: the segmented switch and the fit-to-width frame                  */
/* -------------------------------------------------------------------------- */

export interface PreviewSwitchOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** A small segmented control (radio group) for the preview toolbars. Arrow keys move between options. */
export function PreviewSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly PreviewSwitchOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step || options.length === 0) return;
    event.preventDefault();
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("inline-flex w-fit max-w-full flex-wrap gap-1 rounded-full border p-1", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                : "text-muted-foreground hover:bg-primary/10 hover:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The scale that fits `natural` px into `available` px (1 when it fits or nothing is measured yet). */
export function fitScale(available: number, natural: number): number {
  if (!(available > 0) || !(natural > 0) || available >= natural) return 1;
  return available / natural;
}

/**
 * Draws `children` at `naturalWidth` px and, when the column is narrower,
 * scales the drawing down to fit instead of scrolling the page sideways.
 * `contain: inline-size` keeps the wide drawing from widening a grid or flex
 * parent. The drawing's height is re-read after every render and on resize.
 */
export function FitToWidth({
  naturalWidth,
  children,
  className,
}: {
  naturalWidth: number;
  children: ReactNode;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // The last values set, so an unchanged measurement never schedules a render.
  const last = useRef({ available: 0, contentHeight: 0 });

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport && viewport.clientWidth !== last.current.available) {
      last.current.available = viewport.clientWidth;
      setAvailable(viewport.clientWidth);
    }
    if (content && content.offsetHeight !== last.current.contentHeight) {
      last.current.contentHeight = content.offsetHeight;
      setContentHeight(content.offsetHeight);
    }
  }, []);

  useIsoLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    let observer: ResizeObserver | null = null;
    try {
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => measure());
        if (viewportRef.current) observer.observe(viewportRef.current);
        if (contentRef.current) observer.observe(contentRef.current);
      }
    } catch {
      observer = null;
    }
    window.addEventListener("resize", measure);
    return () => {
      try {
        observer?.disconnect();
      } catch {
        /* ignore */
      }
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const scale = fitScale(available, naturalWidth);
  return (
    <div
      ref={viewportRef}
      data-fit-scale={scale}
      className={cn("w-full min-w-0 max-w-full overflow-hidden [contain:inline-size]", className)}
    >
      <div
        className="mx-auto"
        style={{
          width: naturalWidth * scale,
          height: scale < 1 && contentHeight > 0 ? contentHeight * scale : undefined,
        }}
      >
        <div
          ref={contentRef}
          style={{
            width: naturalWidth,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gmail pieces                                                                */
/* -------------------------------------------------------------------------- */

function GmailAvatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      data-gmail-avatar=""
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: letterTileColor(name),
        color: "#ffffff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: GMAIL_SUBJECT_FONT,
        fontSize: Math.round(size * 0.45),
        fontWeight: 500,
        lineHeight: 1,
      }}
    >
      {letterTileInitial(name)}
    </span>
  );
}

/** The grey "Inbox ×" label chip Gmail puts after the subject. */
function InboxChip() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        marginLeft: 8,
        padding: "0 4px 0 6px",
        borderRadius: 4,
        background: G.chip,
        color: G.icon,
        fontFamily: GMAIL_UI_FONT,
        fontSize: 12,
        lineHeight: "18px",
        verticalAlign: "middle",
        whiteSpace: "nowrap",
      }}
    >
      Inbox
      <X size={12} strokeWidth={2} />
    </span>
  );
}

/** Reply / Forward pills under the message. Drawn, not clickable. */
function ReplyPills() {
  const pill: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 36,
    padding: "0 16px",
    borderRadius: 18,
    border: `1px solid ${G.pillBorder}`,
    color: G.icon,
    fontFamily: GMAIL_UI_FONT,
    fontSize: 14,
    fontWeight: 500,
  };
  return (
    <div aria-hidden="true" style={{ display: "flex", gap: 12, marginTop: 20 }}>
      <span style={pill}>
        <Reply size={18} />
        Reply
      </span>
      <span style={pill}>
        <Forward size={18} />
        Forward
      </span>
    </div>
  );
}

function GmailDetails({
  id,
  name,
  fromAddress,
  toAddress,
  dateLabel,
  subject,
}: {
  id: string;
  name: string;
  fromAddress: string;
  toAddress: string;
  dateLabel: string;
  subject: string;
}) {
  const label: CSSProperties = { padding: "0 12px 0 0", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" };
  const value: CSSProperties = { color: G.text, verticalAlign: "top", overflowWrap: "anywhere" };
  return (
    <div
      id={id}
      data-gmail-details=""
      style={{
        marginTop: 6,
        padding: "8px 12px",
        border: `1px solid ${G.line}`,
        borderRadius: 8,
        background: G.card,
        color: G.muted,
        fontSize: 12,
        lineHeight: "20px",
        maxWidth: "100%",
      }}
    >
      <table role="presentation" style={{ borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={label}>from:</td>
            <td style={value}>
              <span style={{ fontWeight: 700 }}>{name}</span>{" "}
              <span style={{ color: G.muted }}>&lt;{fromAddress}&gt;</span>
            </td>
          </tr>
          <tr>
            <td style={label}>to:</td>
            <td style={value}>{toAddress}</td>
          </tr>
          <tr>
            <td style={label}>date:</td>
            <td style={value}>{dateLabel}</td>
          </tr>
          <tr>
            <td style={label}>subject:</td>
            <td style={value}>{subject}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** "to me ▾": opens the details, as in Gmail. */
function ToMe({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      title={open ? "Hide details" : "Show details"}
      className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 0,
        background: "transparent",
        border: 0,
        color: G.muted,
        fontFamily: GMAIL_UI_FONT,
        fontSize: 12,
        lineHeight: "20px",
        cursor: "pointer",
      }}
    >
      to me
      <ChevronDown size={14} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* The preview                                                                 */
/* -------------------------------------------------------------------------- */

export interface EmailPreviewGmailProps {
  /** The subject with variables already filled. */
  subject: string;
  /** The full HTML document (from `renderNotificationEmailHtml`), variables filled. */
  html: string;
  fromName: string;
  fromAddress: string;
  /** The recipient (the customer, or the operator's own address for a test). */
  toAddress: string;
  /** Replaces the time shown beside the sender, e.g. "9:41 AM (0 minutes ago)". */
  sentAtLabel?: string;
  /** Which width opens first. */
  defaultView?: GmailPreviewView;
  className?: string;
}

const VIEW_OPTIONS: readonly PreviewSwitchOption<GmailPreviewView>[] = [
  { value: "desktop", label: GMAIL_PREVIEW_VIEWS.desktop.label, icon: Monitor },
  { value: "phone", label: GMAIL_PREVIEW_VIEWS.phone.label, icon: Smartphone },
];

export function EmailPreviewGmail({
  subject,
  html,
  fromName,
  fromAddress,
  toAddress,
  sentAtLabel,
  defaultView = "desktop",
  className,
}: EmailPreviewGmailProps) {
  const [view, setView] = useState<GmailPreviewView>(defaultView);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [frameHeight, setFrameHeight] = useState(GMAIL_FRAME_MIN_HEIGHT);
  const [sentAt] = useState(() => new Date());
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const detailsId = `gmail-details-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const spec = GMAIL_PREVIEW_VIEWS[view];
  const address = String(fromAddress ?? "").trim();
  const name = String(fromName ?? "").trim() || address || "Sender";
  const to = String(toAddress ?? "").trim();
  const shownSubject = String(subject ?? "").trim() || "(no subject)";
  const source = String(html ?? "");
  const hasBody = source.trim().length > 0;
  const labels = useMemo(() => gmailDateLabels(sentAt), [sentAt]);
  const bytes = useMemo(() => emailByteSize(source), [source]);
  const clipped = bytes > GMAIL_CLIP_BYTES;

  const heightRef = useRef(GMAIL_FRAME_MIN_HEIGHT);
  const measure = useCallback(() => {
    const height = measureEmailDocumentHeight(iframeRef.current?.contentDocument);
    if (height > 0 && height !== heightRef.current) {
      heightRef.current = height;
      setFrameHeight(height);
    }
  }, []);

  const handleLoad = useCallback(() => {
    unwatchRef.current?.();
    unwatchRef.current = watchEmailDocument(iframeRef.current, measure);
    measure();
  }, [measure]);

  useEffect(
    () => () => {
      unwatchRef.current?.();
      unwatchRef.current = null;
    },
    [],
  );

  // A new width reflows the email, and new HTML may already be loaded: measure
  // again once layout has caught up.
  useEffect(() => {
    measure();
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => measure()) : 0;
    const timer = setTimeout(measure, 150);
    return () => {
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [view, source, measure]);

  const bodyFrame = hasBody ? (
    <iframe
      ref={iframeRef}
      title={`Email: ${shownSubject}`}
      srcDoc={source}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      scrolling="no"
      onLoad={handleLoad}
      data-gmail-body=""
      style={{
        display: "block",
        width: spec.bodyWidth,
        height: frameHeight,
        border: 0,
        overflow: "hidden",
        background: "transparent",
      }}
    />
  ) : (
    <div
      data-gmail-body-empty=""
      style={{
        width: spec.bodyWidth,
        padding: "32px 0",
        textAlign: "center",
        color: G.muted,
        fontSize: 14,
      }}
    >
      This email has no message yet.
    </div>
  );

  const toggleDetails = () => setDetailsOpen((open) => !open);
  const details = detailsOpen ? (
    <GmailDetails
      id={detailsId}
      name={name}
      fromAddress={address}
      toAddress={to}
      dateLabel={labels.details}
      subject={shownSubject}
    />
  ) : null;

  const desktop = (
    <div
      style={{
        width: GMAIL_PREVIEW_VIEWS.desktop.mockupWidth,
        padding: 12,
        borderRadius: 16,
        background: G.frame,
        fontFamily: GMAIL_UI_FONT,
        color: G.text,
      }}
    >
      <div style={{ background: G.card, borderRadius: 16, padding: "4px 24px 24px 16px" }}>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 24, height: 48, color: G.icon }}>
          <ArrowLeft size={20} />
          <Archive size={20} />
          <Trash2 size={20} />
          <Mail size={20} />
          <MoreVertical size={20} />
          <span style={{ marginLeft: "auto", fontSize: 12, color: G.muted }}>1 of 1</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "12px 0 20px 56px" }}>
          <p
            data-gmail-subject=""
            style={{
              margin: 0,
              minWidth: 0,
              fontFamily: GMAIL_SUBJECT_FONT,
              fontSize: 22,
              lineHeight: "28px",
              fontWeight: 400,
              color: G.text,
              overflowWrap: "anywhere",
            }}
          >
            {shownSubject}
            <InboxChip />
          </p>
          <span aria-hidden="true" style={{ marginLeft: "auto", display: "flex", gap: 20, paddingTop: 5, color: G.icon }}>
            <Printer size={18} />
            <ExternalLink size={18} />
          </span>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <GmailAvatar name={name} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <p style={{ margin: 0, minWidth: 0, fontSize: 14, lineHeight: "20px", overflowWrap: "anywhere" }}>
                <span data-gmail-from-name="" style={{ fontWeight: 700, color: G.text }}>
                  {name}
                </span>{" "}
                <span data-gmail-from-address="" style={{ fontSize: 12, color: G.muted }}>
                  &lt;{address}&gt;
                </span>
              </p>
              <span
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexShrink: 0,
                  fontSize: 12,
                  lineHeight: "20px",
                  color: G.muted,
                  whiteSpace: "nowrap",
                }}
              >
                <span suppressHydrationWarning>{sentAtLabel ?? labels.desktop}</span>
                <span aria-hidden="true" style={{ display: "flex", gap: 16, color: G.icon }}>
                  <Star size={18} />
                  <Reply size={18} />
                  <MoreVertical size={18} />
                </span>
              </span>
            </div>
            <ToMe open={detailsOpen} onToggle={toggleDetails} controls={detailsId} />
            {details}
            <div style={{ marginTop: 16 }}>{bodyFrame}</div>
            <ReplyPills />
          </div>
        </div>
      </div>
    </div>
  );

  const phone = (
    <div
      style={{
        width: GMAIL_PREVIEW_VIEWS.phone.mockupWidth,
        padding: 12,
        borderRadius: 16,
        background: G.frame,
        fontFamily: GMAIL_UI_FONT,
        color: G.text,
      }}
    >
      <div style={{ width: 360, background: G.card, borderRadius: 24, overflow: "hidden", paddingBottom: 16 }}>
        <div
          aria-hidden="true"
          style={{ display: "flex", alignItems: "center", height: 56, padding: "0 16px", gap: 20, color: G.icon }}
        >
          <ArrowLeft size={22} />
          <span style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
            <Archive size={20} />
            <Trash2 size={20} />
            <Mail size={20} />
            <MoreVertical size={20} />
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "4px 16px 16px" }}>
          <p
            data-gmail-subject=""
            style={{
              margin: 0,
              minWidth: 0,
              fontFamily: GMAIL_SUBJECT_FONT,
              fontSize: 22,
              lineHeight: "28px",
              fontWeight: 400,
              color: G.text,
              overflowWrap: "anywhere",
            }}
          >
            {shownSubject}
            <InboxChip />
          </p>
          <Star aria-hidden="true" size={20} style={{ marginLeft: "auto", flexShrink: 0, marginTop: 4, color: G.icon }} />
        </div>
        <div style={{ display: "flex", gap: 12, padding: "0 16px" }}>
          <GmailAvatar name={name} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", overflowWrap: "anywhere" }}>
              <span data-gmail-from-name="" style={{ fontWeight: 700, color: G.text }}>
                {name}
              </span>{" "}
              <span suppressHydrationWarning style={{ fontSize: 12, color: G.muted, whiteSpace: "nowrap" }}>
                {sentAtLabel ?? labels.phone}
              </span>
            </p>
            <ToMe open={detailsOpen} onToggle={toggleDetails} controls={detailsId} />
          </div>
          <span aria-hidden="true" style={{ display: "flex", gap: 16, paddingTop: 2, color: G.icon }}>
            <Reply size={20} />
            <MoreVertical size={20} />
          </span>
        </div>
        {details && <div style={{ padding: "0 16px" }}>{details}</div>}
        <div style={{ padding: "12px 8px 0" }}>{bodyFrame}</div>
        <div style={{ padding: "0 16px" }}>
          <ReplyPills />
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Gmail</p>
        <PreviewSwitch label="Preview width" value={view} options={VIEW_OPTIONS} onChange={(next) => setView(next)} />
      </div>
      <figure
        className="m-0 space-y-2"
        data-view={view}
        aria-label={`Email preview in Gmail, ${spec.label.toLowerCase()} width. From ${name}, to ${to || "the customer"}, subject ${shownSubject}.`}
      >
        <FitToWidth naturalWidth={spec.mockupWidth}>{view === "desktop" ? desktop : phone}</FitToWidth>
        <figcaption className="text-xs text-muted-foreground">{GMAIL_PREVIEW_CAPTION}</figcaption>
      </figure>
      {clipped && (
        <p className="text-xs text-amber-700 dark:text-amber-400" role="note">
          Gmail cuts off emails over 102 KB and shows a &ldquo;View entire message&rdquo; link. This one is about{" "}
          {Math.ceil(bytes / 1024)} KB.
        </p>
      )}
    </div>
  );
}
