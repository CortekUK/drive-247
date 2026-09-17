"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useGuardedRouter } from "@/lib/leave-guard";
import { History, LifeBuoy, Maximize2, Minimize2, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { TraxSupportThread } from "./support/TraxSupportThread";
import { useTraxSupportOptional } from "./support/trax-support-context";
import { TraxMark } from "./trax-greeting";
import { isTraxPath, useTraxOptional } from "./trax-provider";
import { supportHref } from "@/lib/support-route";

/**
 * Trax as a FLOATING panel — a chat window above the page, bottom right.
 *
 * ---------------------------------------------------------------------------
 * IT FLOATS: THE PAGE IS NOT TOUCHED
 *
 * Opening Trax must not resize the dashboard. There is no flow gap, no reserved
 * column, no margin on the page: the panel is `position: fixed` and PORTALLED TO
 * <body>, so it is not a child of the layout's flex row and cannot take width
 * from it. The page keeps the width it had, scrolls normally, and stays live
 * underneath — no backdrop, no blur, no focus trap and no scroll lock while the
 * panel floats, because Trax is consulted WHILE reading a record.
 *
 * The portal also solves clipping: the layout bounds some routes with
 * `h-svh overflow-hidden` (Messages), and a fixed child of a clipping or
 * transformed ancestor is clipped with it. From <body> nothing can cut the panel.
 *
 * (An earlier version docked instead: a flow gap narrowed the content column by
 * `--trax-width`, Stripe-assistant style. It read as a second website column and
 * changed every page's available width, so it is gone. The `min-w-0` the layout
 * added for it stays — it lets wide content shrink rather than overflow, which
 * is right with or without a panel beside it.)
 *
 * ---------------------------------------------------------------------------
 * TWO SIZES, ONE PANEL
 *
 *   floating  bottom-right card, `--trax-width` × `--trax-height`
 *             (styles/v2-theme.css; ~400–480px wide, never taller than the
 *             viewport allows).
 *   expanded  the Expand control: a larger focused overlay, still over the same
 *             page, with a light scrim that restores it on click. Restore puts
 *             it back to the floating size. Neither size touches the layout.
 *
 * Below `md` both are the same thing — a near-full-screen overlay inset from the
 * edges, sized against `visualViewport` so the composer stays above the virtual
 * keyboard.
 *
 * Expand no longer navigates to `/trax`. The full page still exists and is still
 * the same conversation (TraxSupportProvider sits above the route); it is
 * reached by its own URL and by the featured card, and returns with "Open as
 * side panel".
 *
 * ---------------------------------------------------------------------------
 * STACKING
 *
 * z-40: above the page and its sticky chrome, below the z-50 modal dialogs, so a
 * dialog still covers Trax rather than fighting it. The two viewport-pinned
 * overlays that would otherwise sit under the panel — the setup guide and the
 * Appearance save bar — read `--trax-offset` and step aside instead.
 *
 * ---------------------------------------------------------------------------
 * ALWAYS MOUNTED, LAZILY FILLED
 *
 * The panel element stays mounted so it can animate both ways. Closed, it is
 * `invisible` as well as offset, which takes it out of the tab order and the
 * accessibility tree. It becomes visible the instant it opens and hidden only
 * once the close animation finishes (see the class list for why that asymmetry
 * is load-bearing). The conversation inside is not rendered until the panel is
 * first opened, so a page load that never opens Trax renders no thread and sends
 * no request for it — and once opened it is KEPT, so closing Trax never loses
 * the thread or a half-typed question.
 *
 * On `/trax` it renders nothing: the full page IS the conversation, and a
 * floating copy over it would be the same thread twice.
 */
/** One header control: compact, labelled for assistive tech, pressed when its view is open. */
function PanelAction({
  label,
  tip,
  icon,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  tip: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={
            "text-muted-foreground hover:text-foreground " +
            (active ? "bg-muted text-foreground" : "")
          }
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

export function TraxPanel() {
  /* Optional: the provider is v2-only, and a panel is never worth throwing for. */
  const trax = useTraxOptional();
  /* The TRAX workspace this panel shows: one conversation and its history.
     Human support is the portal's own Support section, not a view in here. */
  const workspace = useTraxSupportOptional();
  const support = workspace?.support ?? null;
  const pathname = usePathname();
  // Asks a v2 page with unsaved edits before opening Support.
  const router = useGuardedRouter();
  const onFullPage = isTraxPath(pathname);
  const open = !!trax?.sheetOpen && !onFullPage;

  /* First open fills the panel; it then stays filled so reopening is instant.
     Set during render (React's derived-state pattern) rather than in an
     effect, so the thread is already there on the frame the panel appears. */
  const [hasOpened, setHasOpened] = useState(false);
  if (open && !hasOpened) setHasOpened(true);

  /* Floating or the larger focused overlay. Remembered while the session lasts,
     so reopening Trax gives back the size the operator chose. */
  const [expanded, setExpanded] = useState(false);

  /* The portal host. Set in an effect so the server and the first client render
     agree; the panel is closed on that frame anyway. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  /* Arriving back from `/trax` mounts the panel already open. Hold it in the
     closed position for two frames so it animates in instead of snapping. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (onFullPage) {
      setArmed(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [onFullPage]);
  const shown = open && armed;

  /* The virtual keyboard shrinks the VISUAL viewport, not the layout viewport,
     so a fixed panel keeps its full height and the composer ends up behind the
     keyboard. Following `visualViewport` keeps the composer on screen; on a
     desktop this is simply the window height, which the CSS size already fits
     inside. */
  const [visualHeight, setVisualHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!viewport) return;
    const read = () => setVisualHeight(viewport.height);
    read();
    viewport.addEventListener("resize", read);
    return () => viewport.removeEventListener("resize", read);
  }, []);

  /* Hand focus back to the page when the panel closes with focus inside it.
     Without this, focus drops to <body> and a keyboard user starts again from
     the top of the page.
     The target is the last element focused OUTSIDE the panel, tracked with a
     `focusin` listener rather than read when the panel opens: the thread
     focuses its composer from its own effect, and a child's effect runs before
     this component's, so "what had focus on open" would already be the
     composer. */
  const asideRef = useRef<HTMLElement>(null);
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && !asideRef.current?.contains(t)) lastOutsideFocusRef.current = t;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const wasShownRef = useRef(false);
  useEffect(() => {
    if (shown) {
      wasShownRef.current = true;
      return;
    }
    if (!wasShownRef.current) return;
    wasShownRef.current = false;
    const aside = asideRef.current;
    const target = lastOutsideFocusRef.current;
    if (aside && target?.isConnected && aside.contains(document.activeElement)) {
      target.focus({ preventScroll: true });
    }
  }, [shown]);

  /* Publish the panel state on <html> for the viewport-pinned overlays that
     cannot see the panel itself — the setup guide is portalled to <body>, the
     Appearance save bar is `fixed`. They read `--trax-offset`: 0px when Trax is
     closed or below `md`, otherwise wide enough to clear whichever size is open.
     The variables live in styles/v2-theme.css, keyed on these attributes, so the
     sizes have one definition. They exist only while this v2-only component is
     mounted: no v1 page ever gets them. */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-trax-panel", shown ? "open" : "closed");
    root.setAttribute("data-trax-size", expanded ? "expanded" : "floating");
  }, [shown, expanded]);
  useEffect(
    () => () => {
      document.documentElement.removeAttribute("data-trax-panel");
      document.documentElement.removeAttribute("data-trax-size");
    },
    [],
  );

  if (!trax || onFullPage || !host) return null;

  const { closeSheet } = trax;
  const view = workspace?.view ?? "conversation";
  const openSupport = (target: { ticketId?: string; issueId?: string }) => {
    router.push(supportHref(target));
    closeSheet();
  };
  const viewLabel =
    view === "history"
      ? "Conversation history"
      : support?.capabilities?.modelReady
        ? "Assistant · reads your records"
        : "Prepared guidance";

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    /* Escape steps back one level — expanded to floating, floating to closed —
       from anywhere inside the panel. `defaultPrevented` yields to a Radix menu
       or popover that already used this Escape to close itself; `isComposing`
       yields to an IME candidate window. */
    if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (expanded) setExpanded(false);
    else closeSheet();
  };

  return createPortal(
    <>
      {/* Expanded only, and desktop only: a light scrim that says which surface
          has attention and restores the floating size on click. The page still
          scrolls and nothing is trapped — the floating size has no scrim at all. */}
      {shown && expanded && (
        <div
          aria-hidden
          data-slot="trax-scrim"
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-40 hidden bg-foreground/10 md:block motion-safe:animate-in motion-safe:fade-in-0"
        />
      )}

      <aside
        ref={asideRef}
        aria-label="Trax"
        data-slot="trax-panel"
        data-state={shown ? "open" : "closed"}
        data-size={expanded ? "expanded" : "floating"}
        onKeyDown={onKeyDown}
        /* Never taller than the visible viewport, keyboard included. */
        style={visualHeight ? { maxHeight: `${Math.round(visualHeight) - 24}px` } : undefined}
        className={[
          "fixed z-40 flex flex-col overflow-hidden text-foreground",
          /* A card that floats: its own ground, a defined edge, and elevation
             instead of a page column. `bg-app-gradient` keeps the wash the
             conversation was designed against; `bg-background` is the opaque
             ground under it, since the page now shows THROUGH nothing.
             Joined by hand, NOT through `cn()`: tailwind-merge reads
             `bg-app-gradient` as a background COLOUR and drops `bg-background`
             as its conflict, which leaves the panel see-through. */
          "rounded-2xl border border-border/70 bg-background bg-app-gradient shadow-[0_28px_70px_-28px_rgb(0_0_0/0.45)]",
          /* Phone: a near-full-screen overlay, still inset from the edges. */
          "inset-3",
          /* Desktop: pinned to the bottom-right corner, clear of both edges. */
          expanded
            ? "md:inset-auto md:bottom-8 md:right-8 md:h-[var(--trax-expanded-height,min(900px,calc(100dvh-7rem)))] md:w-[var(--trax-expanded-width,min(1100px,calc(100vw-4rem)))]"
            : "md:inset-auto md:bottom-5 md:right-5 md:h-[var(--trax-height,min(720px,calc(100dvh-7rem)))] md:w-[var(--trax-width,440px)]",
          /* Visibility flips ON at once and OFF only after the animation. A
             `visibility` transition interpolates as `hidden` on its very first
             frame, and the composer focuses its textarea on exactly that frame
             — the browser silently refuses to focus a hidden element, so ⌘J
             opened a panel you could not type into. Opening therefore
             transitions transform and opacity alone; closing delays
             `visibility` by the 200ms so the panel stays painted while it goes. */
          shown
            ? "visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out]"
            : "invisible translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms]",
          "motion-reduce:transition-none",
        ].join(" ")}
      >
        {/* 64px, the top bar's height, so the two read as one band across the
            screen. The five controls are the whole workspace: history, a fresh
            thread, the portal's Support section, the larger overlay and close. */}
        <header className="flex h-16 shrink-0 items-center gap-2.5 pl-4 pr-2">
          <TraxMark size="sm" animated={false} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-tight tracking-tight">Trax</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">{viewLabel}</p>
          </div>

          <div className="ml-auto flex items-center gap-0.5">
            <PanelAction
              label="Conversation history"
              tip="Conversation history"
              icon={<History />}
              active={view === "history"}
              disabled={!workspace}
              onClick={() => workspace?.setView(view === "history" ? "conversation" : "history")}
            />
            <PanelAction
              label="New conversation"
              tip="New conversation"
              icon={<SquarePen />}
              /* Not mid-reply: a new conversation discards the pending answer. */
              disabled={!workspace || support!.isLoading || (support!.messages.length === 0 && view === "conversation")}
              onClick={() => workspace?.startNew()}
            />
            {/* Human support lives in the portal's Support section. TRAX closes
                behind it; the conversation and the unsent draft are kept. */}
            <PanelAction label="Open Support" tip="Open Support" icon={<LifeBuoy />} onClick={() => openSupport({})} />
            {/* Bigger, over the same page — not a route, so the page underneath
                keeps its layout and its scroll position. */}
            <PanelAction
              label={expanded ? "Restore panel size" : "Expand panel"}
              tip={expanded ? "Restore size" : "Expand"}
              icon={expanded ? <Minimize2 /> : <Maximize2 />}
              active={expanded}
              onClick={() => setExpanded((previous) => !previous)}
            />
            <PanelAction label="Close Trax" tip="Close · ⌘J" icon={<X />} onClick={closeSheet} />
          </div>
        </header>

        {/* Mounted once opened and kept: closing Trax must not lose the thread
            or a half-typed question. Nothing polls from here. */}
        {hasOpened && <TraxSupportThread density="sheet" autoFocus={shown} onOpenSupport={openSupport} />}
      </aside>
    </>,
    host,
  );
}
