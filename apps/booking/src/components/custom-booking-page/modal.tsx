"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "./icons";
import { useRootTheme } from "./theme-toggle";

/**
 * The site's modal.
 *
 * Radix portals its content to `<body>`, outside the site root, so the panel
 * carries the `cbp` class for the design tokens and mirrors `data-theme` for
 * the mode — see `useRootTheme`. `.cbp-modal` re-clears the root's min-height,
 * which would otherwise stretch the panel down the page.
 *
 * Radix also owns what makes a dialog a dialog: focus is trapped and restored,
 * Escape and the overlay close it, the page behind it is inert to screen
 * readers, and the title/description are wired to `aria-labelledby` and
 * `aria-describedby` without anything here having to remember to.
 */
export function CbpModal({
  open, onOpenChange, title, description, icon, width = "30rem", children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Optional mark in the header, from the site's icon set. */
  icon?: string;
  /** Panel width; the viewport still caps it on a phone. */
  width?: string;
  children: React.ReactNode;
}) {
  const theme = useRootTheme(open);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cbp cbp-overlay" />
        <Dialog.Content
          className="cbp cbp-modal"
          data-theme={theme}
          style={{ ["--modal-w" as string]: width }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {icon && (
                <span className="cbp-modal-mark" aria-hidden="true">
                  <Icon name={icon} className="h-[18px] w-[18px]" />
                </span>
              )}
              <div className="min-w-0">
                <Dialog.Title className="cbp-h3">{title}</Dialog.Title>
                {description
                  ? <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-[var(--body)]">{description}</Dialog.Description>
                  // Radix warns when a dialog has no description; say so explicitly
                  // rather than leaving the association dangling.
                  : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
              </div>
            </div>
            <Dialog.Close aria-label="Close" className="cbp-icon-btn shrink-0">
              <Icon name="close" className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
