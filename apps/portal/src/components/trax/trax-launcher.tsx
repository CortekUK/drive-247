"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { TraxAIDialog } from "@/components/chat";

/**
 * Imperative handle: one verb, "open the Trax conversation".
 */
export type TraxLauncherHandle = {
  open: () => void;
};

/**
 * Trax, mounted without its header pill.
 *
 * The v2 chrome has no top bar, so Trax has to be opened from the right-edge
 * dock — as a plain 36px icon, alongside Messages, Enquiries and
 * Notifications. `@/components/chat` ships Trax as a matched pair: the wide
 * `TraxHeaderButton` pill AND the conversation overlay, bundled inside
 * `TraxAIDialog`, which owns the open/closed state and the ⌘J shortcut. The
 * overlay half (`TraxAIDialogInner`) is deliberately module-private, so there
 * is no supported way to mount the conversation and draw a different opener
 * for it.
 *
 * The two things this must NOT do:
 *
 *   - Stand up a second Trax. Two instances mean two `useChat()` states, i.e.
 *     two separate conversations that each forget what the other was told —
 *     the exact failure the chat module's own comments warn about.
 *   - Reach into `TraxAIDialog` and change it. v1's header still renders it
 *     and 56 tenants are on that path today.
 *
 * So: keep the real component, whole and untouched, and park its pill in a
 * `display: contents` host where a CSS rule takes it out of the layout. The
 * button stays in the DOM, so `.click()` still drives React's own handler and
 * the single instance opens exactly as it does from the header. `display:none`
 * also keeps it out of the accessibility tree and out of the tab order, so it
 * cannot be reached twice. The overlay is `position: fixed` and unaffected by
 * either the host or the rule.
 */
export const TraxLauncher = forwardRef<TraxLauncherHandle>(function TraxLauncher(
  _props,
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      open() {
        // `:scope > button` is the pill and only the pill — the overlay's own
        // buttons (send, clear, close) are nested deeper, so a stray match
        // cannot happen even while the conversation is open.
        hostRef.current
          ?.querySelector<HTMLButtonElement>(":scope > button")
          ?.click();
      },
    }),
    [],
  );

  return (
    <div ref={hostRef} className="contents [&>button]:hidden">
      <TraxAIDialog />
    </div>
  );
});
