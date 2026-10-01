import { useRef, type PointerEvent } from "react";

/**
 * Pointer tilt + a sheen that follows it, for objects drawn as physical things
 * (the payment card, the referral coupon). v2 only.
 *
 * Writes straight to the element's style, not through state: a pointer move is
 * 60 events a second and none of them should re-render React. Motion follows
 * V2_PLAN §12 — transform + opacity only, 200ms, ease-out in / ease-in out —
 * and does nothing for touch or under `prefers-reduced-motion`.
 */
export function useTilt3D<T extends HTMLElement = HTMLDivElement, S extends HTMLElement = HTMLDivElement>({
  maxX = 14,
  maxY = 18,
}: { maxX?: number; maxY?: number } = {}) {
  const ref = useRef<T>(null);
  const sheenRef = useRef<S>(null);

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transition = "transform 200ms ease-out";
    el.style.transform = `rotateX(${(-y * maxX).toFixed(2)}deg) rotateY(${(x * maxY).toFixed(2)}deg)`;
    const sheen = sheenRef.current;
    if (sheen) {
      sheen.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
      sheen.style.opacity = "1";
      sheen.style.transform = `translate(${(x * 60).toFixed(1)}%, ${(y * 60).toFixed(1)}%)`;
    }
  };

  const onPointerLeave = () => {
    const el = ref.current;
    if (el) {
      el.style.transition = "transform 200ms ease-in";
      el.style.transform = "rotateX(0deg) rotateY(0deg)";
    }
    const sheen = sheenRef.current;
    if (sheen) {
      sheen.style.transition = "transform 200ms ease-in, opacity 200ms ease-in";
      sheen.style.opacity = "0";
    }
  };

  return { ref, sheenRef, handlers: { onPointerMove, onPointerLeave } };
}
