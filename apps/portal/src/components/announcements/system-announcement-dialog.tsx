"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  SYSTEM_DIALOG_UI,
  TONE_CLASSES,
  resolveInPortalCta,
  type PortalAnnouncement,
} from "@/lib/announcements/contract";
import { ToneIcon } from "@/components/announcements/tone-icon";

export const HARD_DIALOG_HELPER =
  "Only an admin on your account can resolve this. You can still sign out.";

/**
 * How long a page's own controls (its buttons, the X, Escape, an outside click) ignore
 * being activated after the page changed UNDER them.
 *
 * Every page's footer is laid out in one cell, so the button of the page that takes over
 * sits exactly where the button just pressed was. The first click of a double click on
 * "Got it" dismisses that page and the next one appears in the same moment, and the
 * second click would land on the new page: signing the operator out, pressing a hard
 * page's button, or dismissing a notice nobody read — which for a "Once" notice means it
 * never comes back, recorded as shown AND dismissed. Long enough to swallow a double
 * click (and a stray second tap) and to cover the slide, short enough that nobody
 * deliberately pressing the new page's button notices: they are still reading it.
 *
 * The operator's OWN paging (Previous / Next, the arrow keys) is not held back: they
 * moved the page themselves, and the pager strip is nowhere near the footer.
 */
export const SYSTEM_DIALOG_PAGE_GUARD_MS = 450;

/**
 * The pager's own classes. Local on purpose (the contract's SYSTEM_DIALOG_UI is shared
 * with the admin preview). The dots are the feature dialog's (FEATURE_DIALOG_UI.dot /
 * dotActive: a 6px dot, the showing page a 16px pill), with the pill in the page's own
 * tone; the buttons are the dialog's ghost buttons at a smaller size.
 */
export const SYSTEM_DIALOG_PAGER_UI = {
  /** A strip under the page's buttons, with a hairline above it: navigation, not an action. */
  bar: "flex items-center justify-between gap-2 border-t border-black/5 px-3 py-2.5 dark:border-white/10",
  nav: "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-indigo-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-500/15",
  navIcon: "h-4 w-4",
  middle: "flex min-w-0 items-center gap-2.5",
  dots: "flex items-center gap-1.5",
  dot: "block h-1.5 w-1.5 rounded-full bg-neutral-300 transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none dark:bg-neutral-600",
  dotActive: "block h-1.5 w-4 rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none",
  counter: "select-none whitespace-nowrap text-[12px] font-medium leading-none tabular-nums text-muted-foreground",
  /** The accent stripe follows the page's tone. */
  accentFade: "transition-colors duration-300 ease-out motion-reduce:transition-none",
  /** Every page's text laid out in one cell, so the panel keeps one height across pages. */
  stack: "grid grid-cols-[minmax(0,1fr)]",
  cell: "col-start-1 row-start-1 flex min-w-0 flex-col gap-3",
  /**
   * The hidden sizers, clipped to as much as the body can ever show: the body's own cap
   * (`max-h-[calc(100dvh-13.5rem)]` / `-11.5rem` below and above `sm`) less its padding
   * (pt-6 + pb-2 = 2rem). Without the clip, a set holding one long page gave EVERY page
   * that page's height, so a two-line notice scrolled through thousands of pixels of
   * nothing. With it, the panel still keeps one height (the cap) while a page that
   * really is longer than the cap still scrolls.
   */
  sizers: "col-start-1 row-start-1 overflow-hidden max-sm:max-h-[calc(100dvh-15.5rem)] sm:max-h-[calc(100dvh-13.5rem)]",
} as const;

/**
 * Passing `onUpdate` makes motion drive the slide from JS instead of the Web Animations
 * API (see DRIVE_FROM_JS in feature-announcement-dialog.tsx: with WAAPI, motion 12.34
 * cancels the finished animation a frame before it writes the final style).
 */
const DRIVE_FROM_JS = () => {};

export interface SystemAnnouncementPager {
  /** Every page, in order (hard first, then soft). `announcement` is `items[index]`. */
  items: PortalAnnouncement[];
  /** 0-based page showing. */
  index: number;
  /** The way the last move went: 1 = Next (or the next item taking a closed one's place), -1 = Previous. */
  turn: 1 | -1;
  onPrevious: () => void;
  onNext: () => void;
}

export interface SystemAnnouncementDialogProps {
  announcement: PortalAnnouncement;
  open: boolean;
  /** Soft only: X, Esc, outside click, "Not now", "Got it". The host records `dismissed`. */
  onClose: () => void;
  /** The resolved in-portal href. The host records `cta_clicked` and navigates. */
  onCta: (href: string) => void;
  /** Hard only. The host signs out and replaces to /login. */
  onSignOut: () => void;
  /**
   * Two or more system dialogs due: one dialog, paged. `announcement` is the page
   * showing; closing a soft page closes THAT item only (the host moves on).
   */
  pager?: SystemAnnouncementPager | null;
}

/**
 * A system announcement as a dialog, soft or hard, in either chrome.
 *
 * Built on the v1 `components/ui/dialog` primitive on purpose: it is the one both
 * chromes load, and it sits at the same z-100 as the subscription and migration gates,
 * so an announcement can never paint UNDER a gate it is waiting for. (The host makes
 * sure the two never share the screen in the first place.)
 *
 * SOFT closes every normal way (X, Esc, outside click, "Not now" / "Got it").
 *
 * HARD cannot be closed at all: no X, Esc and outside clicks are swallowed, and
 * `onOpenChange` ignores a close. It is not a trap, because it always offers Sign out
 * (same escape as the subscription gate), it is not shown on the pages that must
 * stay reachable (subscription, credits, settings) nor on its own button's page, and
 * it clears by itself once the tenant fixes the condition or the admin deactivates it.
 *
 * ROLES. Everyone sees it (a blocker blocks the tenant, like the paywall). The button
 * renders only for a valid in-portal path that this user's role may open. When a hard
 * blocker then leaves someone with nothing to press (a viewer, or a manager without
 * that page), a helper line says who can clear it. A viewer gets no button on a hard
 * blocker at all: it would sit right under "Only an admin on your account can
 * resolve this", on pages a read-only role cannot change anyway.
 *
 * FOCUS. The host opens this by itself, mid-session, possibly while someone is typing.
 * Initial focus goes to the panel, never a button, so the next Enter or Space cannot
 * sign anyone out, record a dismissal nobody read, or navigate away from a half-typed
 * form. Tab reaches every button from there.
 *
 * PAGER. With two or more system dialogs due the host passes `pager`, and this is ONE
 * dialog with pages. Under the page's own buttons, a strip: Previous on the left, Next
 * on the right, and between them the dots (the showing page a pill in its tone) and
 * "2 of 3". Left / Right arrow keys page too, while focus is anywhere in the dialog.
 * It loops, and it never pages by itself: people are reading or acting in it.
 *   - Every page keeps its own tone (the accent stripe and the pill follow it), icon,
 *     title, body, button and hard/soft rules. Page to page, the text slides in from
 *     the side it came from and fades, as the feature dialog's slides do (none under
 *     reduced motion).
 *   - A SOFT page closes the normal ways, but that closes only that item: the host
 *     records `dismissed` and the next remaining item takes the page. A HARD page has no
 *     X, swallows Esc and outside clicks, and offers Sign out. While any hard page
 *     remains, the backdrop is the hard one.
 *   - The panel keeps one height for every page (all pages' text and buttons are laid
 *     out in the same cells, the hidden ones invisible and inert), so Previous and Next
 *     never move out from under the pointer. The hidden sizers are clipped to what the
 *     body can show, so a short page beside a long one has no empty space to scroll
 *     through, and every page opens at the TOP of that one scrolling body.
 *   - A polite live region says "Announcement 2 of 3". When the page changes under a
 *     button that was pressed (Got it on a page that went away), focus goes back to the
 *     panel, so a second Enter can never land on the next page's Sign out, and for
 *     SYSTEM_DIALOG_PAGE_GUARD_MS the new page's own controls (its buttons, the X,
 *     Escape, an outside click) do nothing at all, so neither can the second click of a
 *     double click. Paging with Previous / Next or the arrow keys is the operator's own
 *     move and is never held back.
 * With one item there is no pager and nothing else changes.
 *
 * Plain text only. The body keeps its line breaks and is never parsed as HTML.
 */
export function SystemAnnouncementDialog({
  announcement,
  open,
  onClose,
  onCta,
  onSignOut,
  pager = null,
}: SystemAnnouncementDialogProps) {
  const { canAccessRoute, isManager, isReadOnlyRole } = useManagerPermissions();
  const reduceMotion = useReducedMotion() === true;
  // On the accent stripe rather than DialogContent: the v1 primitive's forwardRef type
  // resolves to `never` under this workspace's two copies of @types/react.
  const accentRef = useRef<HTMLDivElement>(null);
  const panelOf = () => accentRef.current?.closest<HTMLElement>("[data-system-announcement-dialog]") ?? null;
  const paged = !!pager && pager.items.length > 1;
  const count = paged ? pager!.items.length : 1;
  const pageIndex = paged ? pager!.index : 0;

  const pageKey = `${announcement.id}:${announcement.revision}`;

  // Which way the text slides: from the right for Next (and for the next item taking
  // the place of one that was closed), from the left for Previous.
  const turn = paged ? pager!.turn : 1;

  // ── A page that changes under the pointer ─────────────────────────────────────
  // For SYSTEM_DIALOG_PAGE_GUARD_MS after the page changes by itself, this page's own
  // controls do nothing, so the second click of a double click cannot reach a page
  // nobody has read. The operator's own paging lifts it at once.
  const held = useRef(false);
  const holdTimer = useRef<number | null>(null);
  /** The page the operator paged AWAY from with the pager's own controls. */
  const pagedFrom = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastPage = useRef(pageKey);

  const hold = (on: boolean) => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    held.current = on;
    if (!on || typeof window === "undefined") return;
    holdTimer.current = window.setTimeout(() => {
      held.current = false;
      holdTimer.current = null;
    }, SYSTEM_DIALOG_PAGE_GUARD_MS);
  };
  /** A page's own control: ignored while the page it belongs to has only just arrived. */
  const ownControl = <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A) => {
      if (held.current) return;
      run(...args);
    };
  /** Paging with the pager's own controls: the operator moved the page themselves. */
  const pageBy = (move: () => void) => {
    pagedFrom.current = pageKey;
    move();
  };

  useLayoutEffect(() => {
    if (lastPage.current === pageKey) return;
    const byOperator = pagedFrom.current === lastPage.current;
    lastPage.current = pageKey;
    pagedFrom.current = null;
    // One scrolling body for every page: a page arriving at the scroll position of a
    // longer one would open below its own title, showing an empty panel with a button.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    hold(!byOperator);
    // `hold` and the refs are stable; this runs on a change of page only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  useEffect(
    () => () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    },
    [],
  );

  // A new page: unless focus is on the pager itself (paging with its buttons), hand it to
  // the panel. The button that was pressed may now be a different button on this page.
  const lastFocusPage = useRef(pageKey);
  useEffect(() => {
    if (lastFocusPage.current === pageKey) return;
    lastFocusPage.current = pageKey;
    const panel = panelOf();
    if (!panel || typeof document === "undefined") return;
    const active = document.activeElement;
    if (active && active !== document.body && panel.contains(active) && active.closest("[data-system-dialog-pager]")) {
      return;
    }
    panel.focus();
  }, [pageKey]);

  const onPagerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!paged || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    pageBy(e.key === "ArrowRight" ? pager!.onNext : pager!.onPrevious);
  };

  /** Everything one page shows, decided the same way for the page showing and the hidden sizers. */
  const model = (a: PortalAnnouncement) => {
    const isHard = a.blocking === "hard";
    const tone = a.tone ?? "info";
    const cta = a.cta_label ? resolveInPortalCta(a.cta_url) : null;
    const ctaPermitted = !!cta && canAccessRoute(cta.pathname);
    return {
      hard: isHard,
      tone,
      toneClasses: TONE_CLASSES[tone] ?? TONE_CLASSES.info,
      cta,
      showCta: !!cta && ctaPermitted && !(isHard && isReadOnlyRole),
      showHelper: isHard && (isReadOnlyRole || (isManager && !!cta && !ctaPermitted)),
    };
  };

  const page = model(announcement);
  const { hard, tone, toneClasses } = page;
  const anyHard = paged ? pager!.items.some((a) => a.blocking === "hard") : hard;

  const footerButtons = (a: PortalAnnouncement, m: ReturnType<typeof model>): ReactNode => {
    const ctaButton = m.showCta ? (
      <button
        type="button"
        className={cn(SYSTEM_DIALOG_UI.action, m.toneClasses.dialogAction)}
        onClick={ownControl(() => onCta(m.cta!.href))}
      >
        {a.cta_label}
      </button>
    ) : null;
    if (m.hard) {
      return (
        <>
          <button type="button" className={SYSTEM_DIALOG_UI.secondaryButton} onClick={ownControl(onSignOut)}>
            Sign out
          </button>
          {ctaButton}
        </>
      );
    }
    if (ctaButton) {
      return (
        <>
          <button type="button" className={SYSTEM_DIALOG_UI.secondaryButton} onClick={ownControl(onClose)}>
            Not now
          </button>
          {ctaButton}
        </>
      );
    }
    return (
      <button type="button" className={cn(SYSTEM_DIALOG_UI.action, m.toneClasses.dialogAction)} onClick={ownControl(onClose)}>
        Got it
      </button>
    );
  };

  const pageText = (a: PortalAnnouncement, m: ReturnType<typeof model>, live: boolean) => (
    <>
      <div className={cn(SYSTEM_DIALOG_UI.icon, m.toneClasses.dialogIcon)}>
        <ToneIcon tone={m.tone} className="h-5 w-5" />
      </div>
      {live ? (
        <DialogTitle className={cn(SYSTEM_DIALOG_UI.title, "break-words")}>{a.title}</DialogTitle>
      ) : (
        <h2 className={cn(SYSTEM_DIALOG_UI.title, "break-words")}>{a.title}</h2>
      )}
      {live ? (
        <DialogDescription className={SYSTEM_DIALOG_UI.text}>{a.body}</DialogDescription>
      ) : (
        <p className={SYSTEM_DIALOG_UI.text}>{a.body}</p>
      )}
      {m.showHelper && (
        <p className={SYSTEM_DIALOG_UI.helper} data-announcement-helper={live ? "" : undefined}>
          {HARD_DIALOG_HELPER}
        </p>
      )}
    </>
  );

  return (
    <Dialog
      open={open}
      // Escape, an outside click and the X all land here (and on a hard page nowhere).
      onOpenChange={ownControl((next: boolean) => {
        if (!next && !hard) onClose();
      })}
    >
      <DialogContent
        showCloseButton={false}
        // `!`: the primitive's `data-[state=open]:animate-in` is (0,2,0) and would outrank
        // a plain `motion-reduce:animate-none` (0,1,0); the panel kept zooming in.
        overlayClassName={cn(
          anyHard ? SYSTEM_DIALOG_UI.overlayHard : SYSTEM_DIALOG_UI.overlaySoft,
          "motion-reduce:!animate-none",
        )}
        // The contract's `border-0` removes the primitive's edge; in dark mode the panel
        // would otherwise sit on the backdrop with no visible outline.
        className={cn(
          SYSTEM_DIALOG_UI.panel,
          "motion-reduce:!animate-none outline-none dark:ring-1 dark:ring-white/10",
        )}
        data-system-announcement-dialog=""
        data-blocking={announcement.blocking}
        data-tone={tone}
        data-page-count={paged ? count : undefined}
        data-page-index={paged ? pageIndex : undefined}
        onKeyDown={paged ? onPagerKeyDown : undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onEscapeKeyDown={hard ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={hard ? (e) => e.preventDefault() : undefined}
        onInteractOutside={hard ? (e) => e.preventDefault() : undefined}
      >
        <div
          ref={accentRef}
          aria-hidden="true"
          className={cn(SYSTEM_DIALOG_UI.accent, toneClasses.dialogAccent, paged && SYSTEM_DIALOG_PAGER_UI.accentFade)}
        />

        <div
          ref={bodyRef}
          data-system-dialog-body=""
          // The contract cap reserves 12rem, about twice the real chrome (accent + footer:
          // ~134px stacked below `sm`, ~86px in a row), which left one body line on a
          // short landscape phone. These size it against that chrome instead. The pager
          // strip adds ~53px, so a paged dialog reserves that much more.
          className={cn(
            SYSTEM_DIALOG_UI.body,
            paged
              ? "max-sm:max-h-[calc(100dvh-13.5rem)] sm:max-h-[calc(100dvh-11.5rem)]"
              : "max-sm:max-h-[calc(100dvh-10rem)] sm:max-h-[calc(100dvh-8rem)]",
          )}
        >
          {paged ? (
            <div className={SYSTEM_DIALOG_PAGER_UI.stack}>
              <div
                aria-hidden="true"
                inert
                data-system-dialog-sizers=""
                className={cn(SYSTEM_DIALOG_PAGER_UI.stack, SYSTEM_DIALOG_PAGER_UI.sizers)}
              >
                {pager!.items.map((a) => (
                  <div
                    key={a.id}
                    aria-hidden="true"
                    inert
                    data-system-dialog-sizer=""
                    className={cn(SYSTEM_DIALOG_PAGER_UI.cell, "invisible")}
                  >
                    {pageText(a, model(a), false)}
                  </div>
                ))}
              </div>
              <motion.div
                key={pageKey}
                data-system-dialog-page={announcement.id}
                className={SYSTEM_DIALOG_PAGER_UI.cell}
                initial={reduceMotion ? false : { opacity: 0, x: turn * 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                onUpdate={DRIVE_FROM_JS}
              >
                {pageText(announcement, page, true)}
              </motion.div>
            </div>
          ) : (
            <>
              <div className={cn(SYSTEM_DIALOG_UI.icon, toneClasses.dialogIcon)}>
                <ToneIcon tone={tone} className="h-5 w-5" />
              </div>
              <DialogTitle className={cn(SYSTEM_DIALOG_UI.title, "break-words")}>{announcement.title}</DialogTitle>
              <DialogDescription className={SYSTEM_DIALOG_UI.text}>{announcement.body}</DialogDescription>
              {page.showHelper && (
                <p className={SYSTEM_DIALOG_UI.helper} data-announcement-helper="">
                  {HARD_DIALOG_HELPER}
                </p>
              )}
            </>
          )}
        </div>

        {paged ? (
          // Every page's buttons in one cell: the row is as tall as the tallest page's
          // (two stacked buttons on a phone), and the one showing is the only one that
          // can be seen, focused or pressed.
          <div className={SYSTEM_DIALOG_PAGER_UI.stack} data-system-dialog-footers="">
            {pager!.items.map((a, i) => {
              const showing = i === pageIndex;
              return (
                <div
                  // Keyed by id AND revision: a page's buttons are its own elements, never
                  // another page's reused.
                  key={`${a.id}:${a.revision}`}
                  data-system-dialog-footer={a.id}
                  data-active={showing ? "" : undefined}
                  aria-hidden={showing ? undefined : true}
                  inert={!showing}
                  className={cn(
                    SYSTEM_DIALOG_UI.footer,
                    "col-start-1 row-start-1 min-w-0",
                    showing ? "visible" : "invisible",
                  )}
                >
                  {footerButtons(a, showing ? page : model(a))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={SYSTEM_DIALOG_UI.footer}>{footerButtons(announcement, page)}</div>
        )}

        {paged && (
          <div
            role="group"
            aria-label="Announcements"
            data-system-dialog-pager=""
            className={SYSTEM_DIALOG_PAGER_UI.bar}
          >
            <button
              type="button"
              aria-label="Previous announcement"
              className={SYSTEM_DIALOG_PAGER_UI.nav}
              onClick={() => pageBy(pager!.onPrevious)}
            >
              <ChevronLeft className={SYSTEM_DIALOG_PAGER_UI.navIcon} aria-hidden="true" />
              <span aria-hidden="true">Previous</span>
            </button>
            <div className={SYSTEM_DIALOG_PAGER_UI.middle}>
              <div aria-hidden="true" className={SYSTEM_DIALOG_PAGER_UI.dots} data-system-dialog-dots="">
                {pager!.items.map((a, i) => (
                  <span
                    key={a.id}
                    data-system-dialog-dot={i}
                    data-active={i === pageIndex ? "" : undefined}
                    className={
                      i === pageIndex
                        ? cn(SYSTEM_DIALOG_PAGER_UI.dotActive, toneClasses.dialogAccent)
                        : SYSTEM_DIALOG_PAGER_UI.dot
                    }
                  />
                ))}
              </div>
              <span aria-hidden="true" data-system-dialog-counter="" className={SYSTEM_DIALOG_PAGER_UI.counter}>
                {pageIndex + 1} of {count}
              </span>
            </div>
            <button
              type="button"
              aria-label="Next announcement"
              className={SYSTEM_DIALOG_PAGER_UI.nav}
              onClick={() => pageBy(pager!.onNext)}
            >
              <span aria-hidden="true">Next</span>
              <ChevronRight className={SYSTEM_DIALOG_PAGER_UI.navIcon} aria-hidden="true" />
            </button>
            <span className="sr-only" aria-live="polite" aria-atomic="true" data-system-dialog-live="">
              Announcement {pageIndex + 1} of {count}
            </span>
          </div>
        )}

        {/* Last in the DOM, so Tab from the panel reaches the footer before the X. */}
        {!hard && (
          <button type="button" aria-label="Close" className={SYSTEM_DIALOG_UI.close} onClick={ownControl(onClose)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
