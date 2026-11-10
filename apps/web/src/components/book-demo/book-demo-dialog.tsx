"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { MOTION_CONTENT } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { BookDemoFlow } from "./book-demo-flow";
import "./book-demo.css";

/*
 * The one "Book a demo" dialog for the whole site, mounted once in the root layout.
 *
 * Every Book a demo button is still a plain link to /strategy-call, and this catches a
 * click on any of them and opens the dialog instead. So a new button needs nothing but
 * that link, and the link still works when it is opened in a new tab or arrives from an
 * old email: /strategy-call sends the visitor to /?demo=1, which opens this on arrival.
 *
 * The frame is the operator portal's "add" dialog: 720px, its large corner radius, its
 * accent wash, no close button (the foot's Cancel closes it, and so does Escape).
 */

const OPEN_EVENT = "drive247:book-demo";
const PATH = "/strategy-call";

/** Open the dialog from code (a button that is not a link). */
export function openBookDemo() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function BookDemoDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);

    // Arriving on /?demo=1: open, and tidy the address so a refresh does not reopen it.
    const url = new URL(window.location.href);
    if (url.searchParams.has("demo")) {
      url.searchParams.delete("demo");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      show();
    }

    const onClick = (event: MouseEvent) => {
      // A new tab, a new window or a download is the visitor's choice: leave it alone.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      if (link.origin !== window.location.origin || link.pathname.replace(/\/$/, "") !== PATH) return;
      event.preventDefault();
      show();
    };

    // Capture, so this runs before a link's own handler starts a navigation.
    document.addEventListener("click", onClick, true);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        {/* The portal's scrim: lighter, with the page blurred behind it. */}
        <DialogOverlay className="bg-black/30 supports-[backdrop-filter]:backdrop-blur-md" />
        <DialogPrimitive.Content
          // A stray click beside a half-filled form, or beside the calendar, must not throw it away.
          onInteractOutside={(event) => event.preventDefault()}
          // The flow puts the cursor in its own first field.
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={cn(
            "bd-dialog pv2-tokens fixed top-1/2 left-1/2 z-50 max-h-[calc(100svh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-x-hidden overflow-y-auto text-sm shadow-xl ring-1 ring-foreground/5 outline-none sm:max-w-[720px] dark:ring-foreground/10",
            MOTION_CONTENT,
          )}
        >
          <DialogTitle className="sr-only">Book a demo</DialogTitle>
          <DialogDescription className="sr-only">A few questions about your fleet, then pick a time for the call.</DialogDescription>
          <BookDemoFlow onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
