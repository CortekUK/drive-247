"use client";

import { useEffect, useRef, type ComponentType, type HTMLAttributes } from "react";

interface AnimatedIconRef {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * Wraps a lucide-animated icon so it can be used like a lucide-react icon.
 * - Converts className h-X/w-X to a pixel size prop
 * - Attaches hover listeners to the closest interactive parent (button/link),
 *   so the animation triggers on the full row hover, not just the tiny icon area
 */
export function wrapAnimatedIcon(
  AnimatedIcon: ComponentType<
    { size?: number; className?: string; ref?: React.Ref<AnimatedIconRef> } & HTMLAttributes<HTMLDivElement>
  >
) {
  const Wrapped = ({ className, ...props }: { className?: string } & HTMLAttributes<HTMLDivElement>) => {
    const iconRef = useRef<AnimatedIconRef>(null);
    const containerRef = useRef<HTMLSpanElement>(null);

    const sizeMatch = className?.match(/h-(\d+(?:\.\d+)?)/);
    let size = 16;
    if (sizeMatch) {
      const val = parseFloat(sizeMatch[1]);
      size = val * 4;
    }

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const parent = container.closest("a, button, [role='button']");
      if (!parent) return;

      const handleEnter = () => iconRef.current?.startAnimation();
      const handleLeave = () => iconRef.current?.stopAnimation();

      parent.addEventListener("mouseenter", handleEnter);
      parent.addEventListener("mouseleave", handleLeave);

      return () => {
        parent.removeEventListener("mouseenter", handleEnter);
        parent.removeEventListener("mouseleave", handleLeave);
      };
    }, []);

    return (
      <span ref={containerRef} className="inline-flex shrink-0">
        <AnimatedIcon ref={iconRef} size={size} className={className} {...props} />
      </span>
    );
  };

  Wrapped.displayName = "AnimatedWrapper";
  return Wrapped;
}
