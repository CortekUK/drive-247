"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

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
 *   4. draw a "Change image" handle over every `[data-cms-image]`, and post
 *      `cms:image-click` with the path when one is pressed — the portal owns
 *      the media library, the upload and the write;
 *   5. scroll to a section or refresh the server render when told to.
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
  const queryClient = useQueryClient();
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
    const armText = () => {
      document.querySelectorAll<HTMLElement>("[data-cms]").forEach((el) => {
        if (armed.has(el)) return;
        armed.add(el);
        el.contentEditable = "plaintext-only";
        el.spellcheck = false;
        el.classList.add("cms-editable");

        // A link's text is editable too; clicking it must not navigate. The
        // same guard stops a host widget reacting — the FAQ question lives
        // inside the accordion's own <button>, and without this every click
        // into it would collapse the answer underneath.
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        el.addEventListener("mousedown", (e) => e.stopPropagation());
        el.addEventListener("focus", () => post({ type: "cms:focused", path: el.dataset.cms }));
        el.addEventListener("keydown", (e) => {
          // Typing inside a <button> must not reach the button: Space would
          // otherwise activate it instead of inserting a space.
          e.stopPropagation();
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
          const value = (el.textContent ?? "").replace(/ /g, " ");
          if (value === el.dataset.cmsOriginal) return;
          post({ type: "cms:edit", path: el.dataset.cms, value });
        });
      });
    };

    /* ── images ─────────────────────────────────────────────────────────────
     *
     * An image cannot be typed into, so it gets a handle instead of
     * contentEditable. The handles live in ONE absolutely-positioned layer on
     * <body> rather than being injected next to each image, for two reasons
     * that are both load-bearing here:
     *
     *  - several of these images are unreachable by a click where they are.
     *    The hero car sits under the readiness card, the feature-card photo
     *    carries `pointer-events-none`, and the CTA banner's background is a
     *    `fill` image at `-z-20` behind a black scrim. A handle in its own
     *    layer is reachable regardless;
     *  - React owns the page's DOM. Anything this file inserts INSIDE the tree
     *    is liable to be removed the next time the server tree re-renders,
     *    and re-inserting it would fight the reconciler.
     *
     * The frame itself is `pointer-events: none` — only the small pill takes
     * clicks — so the CTA banner's headline stays editable even though the
     * image behind it is the size of the section.
     */

    const layer = document.createElement("div");
    layer.className = "cms-image-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);

    /** The images the handles were built for, in the same order. */
    let tracked: HTMLElement[] = [];

    const positionHandles = () => {
      const frames = layer.children;
      for (let i = 0; i < tracked.length; i += 1) {
        const frame = frames[i] as HTMLElement | undefined;
        if (!frame) continue;
        const rect = tracked[i].getBoundingClientRect();
        // Document coordinates: the layer has no positioned ancestor, so its
        // containing block is the initial one and top/left are absolute on the
        // page — which means these survive scrolling with no scroll listener.
        frame.style.top = `${rect.top + window.scrollY}px`;
        frame.style.left = `${rect.left + window.scrollX}px`;
        frame.style.width = `${rect.width}px`;
        frame.style.height = `${rect.height}px`;
        // An image inside a `hidden lg:block` wrapper still has a marker; do
        // not draw a zero-sized handle for it.
        frame.style.display = rect.width < 8 || rect.height < 8 ? "none" : "";

        /*
          Keep the pill inside the VIEWPORT as well as inside the frame.
          Several of these images are deliberately bled past the edge of the
          page — the CTA banner's background starts left of x=0 and the hero
          car runs 15% wider than its column — so a handle pinned to the
          image's own top-left corner is half off-screen and, on a tall
          background, above the fold entirely.
        */
        const pill = frame.firstElementChild as HTMLElement | null;
        if (pill) {
          pill.style.left = `${Math.max(8, Math.min(Math.max(8, rect.width - 130), -rect.left + 8))}px`;
          pill.style.top = `${Math.max(8, Math.min(Math.max(8, rect.height - 40), -rect.top + 8))}px`;
        }
      }
    };

    const armImages = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>("[data-cms-image]"));
      const changed =
        found.length !== tracked.length || found.some((el, i) => el !== tracked[i]);

      if (changed) {
        layer.replaceChildren();
        tracked = found;
        for (const el of found) {
          const frame = document.createElement("div");
          frame.className = "cms-image-frame";

          const button = document.createElement("button");
          button.type = "button";
          button.className = "cms-image-btn";
          button.textContent = "Change image";
          button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            post({
              type: "cms:image-click",
              path: el.dataset.cmsImage,
              // The RAW stored value, not `img.src` — next/image rewrites that
              // into `/_next/image?url=…`, which is meaningless to the portal.
              src: el.dataset.cmsImageSrc ?? "",
              alt: el.getAttribute("alt") ?? "",
            });
          });

          frame.appendChild(button);
          layer.appendChild(frame);
        }
      }
      positionHandles();
    };

    const arm = () => {
      armText();
      armImages();
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
        /*
          `router.refresh()` re-runs the SERVER tree, which is where every
          section's copy comes from — so a section edit lands with it alone.

          The FAQ questions and the customer quotes do not. They are table rows
          rendered by client components that hold them in React Query with a
          60-second staleTime, so a refresh hands them a new `seed` prop they
          ignore and the operator watches their own edit fail to appear. These
          two keys are invalidated by hand for that reason.

          Only these two. Invalidating the CMS page query would be actively
          wrong: the client fetch does not ask for `draft_content`, so it would
          replace the draft the operator is previewing with the LIVE copy.
        */
        void queryClient.invalidateQueries({ queryKey: ["faqs"] });
        void queryClient.invalidateQueries({ queryKey: ["testimonials"] });
        router.refresh();
      }
    };

    window.addEventListener("message", onMessage);

    // Re-arm after a server refresh swaps the DOM under us, and keep the rail's
    // offsets — and every image handle — honest as images load and shift the
    // layout.
    const observer = new MutationObserver(() => {
      if (!parentOrigin.current) return;
      // The handle layer lives on <body>, so building it is itself a mutation.
      // This settles rather than looping: the second pass finds the same set of
      // images, rebuilds nothing, and only re-reads positions.
      arm();
      reportSections();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onResize = () => {
      if (!parentOrigin.current) return;
      positionHandles();
      reportSections();
    };
    window.addEventListener("resize", onResize);
    // Fonts and images settle after paint and move everything below them.
    const settle = window.setInterval(() => {
      if (parentOrigin.current) positionHandles();
    }, 1000);

    // Announce ourselves so a portal that loaded first can hello us back.
    window.parent.postMessage({ type: "cms:embedded" }, "*");

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", onResize);
      window.clearInterval(settle);
      observer.disconnect();
      layer.remove();
    };
  }, [router, queryClient]);

  return null;
}
