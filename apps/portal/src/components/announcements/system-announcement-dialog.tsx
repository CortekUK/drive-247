"use client";

import { X } from "lucide-react";
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

export interface SystemAnnouncementDialogProps {
  announcement: PortalAnnouncement;
  open: boolean;
  /** Soft only: X, Esc, outside click, "Not now", "Got it". The host records `dismissed`. */
  onClose: () => void;
  /** The resolved in-portal href. The host records `cta_clicked` and navigates. */
  onCta: (href: string) => void;
  /** Hard only. The host signs out and replaces to /login. */
  onSignOut: () => void;
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
 * Plain text only. The body keeps its line breaks and is never parsed as HTML.
 */
export function SystemAnnouncementDialog({
  announcement,
  open,
  onClose,
  onCta,
  onSignOut,
}: SystemAnnouncementDialogProps) {
  const { canAccessRoute, isManager, isReadOnlyRole } = useManagerPermissions();

  const hard = announcement.blocking === "hard";
  const tone = announcement.tone ?? "info";
  const toneClasses = TONE_CLASSES[tone] ?? TONE_CLASSES.info;

  const cta = announcement.cta_label ? resolveInPortalCta(announcement.cta_url) : null;
  const ctaPermitted = !!cta && canAccessRoute(cta.pathname);
  const showCta = !!cta && ctaPermitted && !(hard && isReadOnlyRole);
  const showHelper = hard && (isReadOnlyRole || (isManager && !!cta && !ctaPermitted));

  const ctaButton = showCta ? (
    <button
      type="button"
      className={cn(SYSTEM_DIALOG_UI.action, toneClasses.dialogAction)}
      onClick={() => onCta(cta!.href)}
    >
      {announcement.cta_label}
    </button>
  ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !hard) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // `!`: the primitive's `data-[state=open]:animate-in` is (0,2,0) and would outrank
        // a plain `motion-reduce:animate-none` (0,1,0); the panel kept zooming in.
        overlayClassName={cn(
          hard ? SYSTEM_DIALOG_UI.overlayHard : SYSTEM_DIALOG_UI.overlaySoft,
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
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onEscapeKeyDown={hard ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={hard ? (e) => e.preventDefault() : undefined}
        onInteractOutside={hard ? (e) => e.preventDefault() : undefined}
      >
        <div aria-hidden="true" className={cn(SYSTEM_DIALOG_UI.accent, toneClasses.dialogAccent)} />

        <div
          data-system-dialog-body=""
          // The contract cap reserves 12rem, about twice the real chrome (accent + footer:
          // ~134px stacked below `sm`, ~86px in a row), which left one body line on a
          // short landscape phone. These size it against that chrome instead.
          className={cn(
            SYSTEM_DIALOG_UI.body,
            "max-sm:max-h-[calc(100dvh-10rem)] sm:max-h-[calc(100dvh-8rem)]",
          )}
        >
          <div className={cn(SYSTEM_DIALOG_UI.icon, toneClasses.dialogIcon)}>
            <ToneIcon tone={tone} className="h-5 w-5" />
          </div>
          <DialogTitle className={cn(SYSTEM_DIALOG_UI.title, "break-words")}>{announcement.title}</DialogTitle>
          <DialogDescription className={SYSTEM_DIALOG_UI.text}>{announcement.body}</DialogDescription>
          {showHelper && (
            <p className={SYSTEM_DIALOG_UI.helper} data-announcement-helper="">
              {HARD_DIALOG_HELPER}
            </p>
          )}
        </div>

        <div className={SYSTEM_DIALOG_UI.footer}>
          {hard ? (
            <>
              <button type="button" className={SYSTEM_DIALOG_UI.secondaryButton} onClick={onSignOut}>
                Sign out
              </button>
              {ctaButton}
            </>
          ) : ctaButton ? (
            <>
              <button type="button" className={SYSTEM_DIALOG_UI.secondaryButton} onClick={onClose}>
                Not now
              </button>
              {ctaButton}
            </>
          ) : (
            <button
              type="button"
              className={cn(SYSTEM_DIALOG_UI.action, toneClasses.dialogAction)}
              onClick={onClose}
            >
              Got it
            </button>
          )}
        </div>

        {/* Last in the DOM, so Tab from the panel reaches the footer before the X. */}
        {!hard && (
          <button type="button" aria-label="Close" className={SYSTEM_DIALOG_UI.close} onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
