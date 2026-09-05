"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * The in-place editor. Mounted ONLY in edit mode (see `app/layout.tsx`), and
 * even then it does nothing until the portal that embedded us says hello.
 *
 * ── the contract with the portal ──────────────────────────────────────────
 *
 * The site never writes. It has no session, no service key, and no idea who
 * is looking at it. Everything it does is:
 *
 *   1. wait for a `cms:hello` from a parent window whose origin is a portal
 *      host (`*.portal.drive-247.com`, or `*.portal.localhost:*` in dev);
 *   2. report the page's sections — `[data-cms-section]` — so the portal can
 *      draw a rail;
 *   3. make every `[data-cms]` node editable in place, and post `cms:edit`
 *      with the path and the new text when one changes;
 *   4. scroll to a section or refresh the server render when told to.
 *
 * The PORTAL owns the write: it is the thing with an authenticated session and
 * a tenant, and it already has a tenant-scoped write path. Keeping every write
 * on that side means edit mode adds no trust surface here — a stranger who
 * opens `?cms-edit=1` on the public URL sees the draft copy (which they could
 * read from PostgREST anyway; RLS is off on these tables) and can type into
 * boxes that post to a parent window that is not listening.
 *
 * ── why contentEditable and not a form ────────────────────────────────────
 *
 * Because the entire point is that there is no form. The operator sees the
 * page as their customer sees it and changes the words where they are. The
 * blast radius of contentEditable — pasted markup, nested elements — is
 * contained by writing back `textContent` only and by the rule in
 * `lib/cms/editable.tsx` that a marked node contains nothing but its field.
 */

const PORTAL_ORIGIN = /^https?:\/\/[a-z0-9-]+\.portal\.(drive-247\.com|localhost)(:\d+)?$/i;

type Inbound =
  | { type: "cms:hello" }
  | { type: "cms:scroll"; id: string }
  | { type: "cms:refresh" }
  | { type: "cms:focus"; path: string };

export function CmsEditOverlay() {
  const router = useRouter();
  const parentOrigin = useRef<string | null>(null);

  useEffect(() => {
    if (window.parent === window) return; // not embedded — stay inert

    const post = (message: unknown) => {
      if (parentOrigin.current) window.parent.postMessage(message, parentOrigin.current);
    };

    const reportSections = () => {
      const items = Array.from(document.querySelectorAll<HTMLElement>("[data-cms-section]")).map(
        (el) => ({
          id: el.dataset.cmsSection ?? "",
          label: el.dataset.cmsLabel ?? el.dataset.cmsSection ?? "",
          top: Math.round(el.getBoundingClientRect().top + window.scrollY),
        }),
      );
      post({ type: "cms:sections", items });
    };

    /* ── make the marked nodes editable ─────────────────────────────────── */

    const armed = new WeakSet<HTMLElement>();
    const arm = () => {
      document.querySelectorAll<HTMLElement>("[data-cms]").forEach((el) => {
        if (armed.has(el)) return;
        armed.add(el);
        el.contentEditable = "plaintext-only";
        el.spellcheck = false;
        el.classList.add("cms-editable");

        // A link's text is editable too; clicking it must not navigate.
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        el.addEventListener("focus", () => post({ type: "cms:focused", path: el.dataset.cms }));
        el.addEventListener("keydown", (e) => {
          // Single-line by default: Enter commits. Shift+Enter is allowed only
          // where the field is genuinely multi-line (a textarea in the portal).
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            el.blur();
          }
          if (e.key === "Escape") {
            el.textContent = el.dataset.cmsOriginal ?? el.textContent;
            el.blur();
          }
        });
        el.addEventListener("focusin", () => {
          el.dataset.cmsOriginal = el.textContent ?? "";
        });
        el.addEventListener("blur", () => {
          const value = (el.textContent ?? "").replace(/ /g, " ");
          if (value === el.dataset.cmsOriginal) return;
          post({ type: "cms:edit", path: el.dataset.cms, value });
        });
      });
    };

    /* ── listen to the portal ───────────────────────────────────────────── */

    const onMessage = (event: MessageEvent<Inbound>) => {
      if (!PORTAL_ORIGIN.test(event.origin)) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "cms:hello") {
        parentOrigin.current = event.origin;
        document.documentElement.classList.add("cms-edit-mode");
        arm();
        reportSections();
        post({ type: "cms:ready", href: location.pathname });
        return;
      }
      if (!parentOrigin.current) return;

      if (msg.type === "cms:scroll") {
        document
          .querySelector<HTMLElement>(`[data-cms-section="${CSS.escape(msg.id)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (msg.type === "cms:focus") {
        document.querySelector<HTMLElement>(`[data-cms="${CSS.escape(msg.path)}"]`)?.focus();
      } else if (msg.type === "cms:refresh") {
        router.refresh();
      }
    };

    window.addEventListener("message", onMessage);

    // Re-arm after a server refresh swaps the DOM under us, and keep the rail's
    // offsets honest as images load and shift the layout.
    const observer = new MutationObserver(() => {
      if (!parentOrigin.current) return;
      arm();
      reportSections();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Announce ourselves so a portal that loaded first can hello us back.
    window.parent.postMessage({ type: "cms:embedded" }, "*");

    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [router]);

  return null;
}
