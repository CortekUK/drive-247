"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface ReceiptIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ReceiptIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BODY_VARIANTS: Variants = {
  normal: { y: 0, scale: 1 },
  animate: {
    y: [0, -1.5, 0],
    scale: [1, 1.03, 1],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const LINE_DRAW: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0.4, 1],
    transition: { duration: 0.5, ease: "easeOut", delay: 0.15 },
  },
};

const DOLLAR_DRAW: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0.3, 1],
    transition: { duration: 0.6, ease: "easeInOut", delay: 0.1 },
  },
};

const ReceiptIcon = forwardRef<ReceiptIconHandle, ReceiptIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const lineControls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => {
          controls.start("animate");
          lineControls.start("animate");
        },
        stopAnimation: () => {
          controls.start("normal");
          lineControls.start("normal");
        },
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
          lineControls.start("animate");
        }
      },
      [controls, lineControls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
          lineControls.start("normal");
        }
      },
      [controls, lineControls, onMouseLeave]
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <motion.svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.g variants={BODY_VARIANTS} initial="normal" animate={controls}>
            {/* Receipt body with zigzag edges */}
            <motion.path
              d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"
              variants={LINE_DRAW}
              initial="normal"
              animate={controls}
            />
            {/* Vertical dollar line */}
            <motion.path
              d="M12 17V7"
              variants={DOLLAR_DRAW}
              initial="normal"
              animate={lineControls}
            />
            {/* Dollar S-curve */}
            <motion.path
              d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"
              variants={DOLLAR_DRAW}
              initial="normal"
              animate={lineControls}
            />
          </motion.g>
        </motion.svg>
      </div>
    );
  }
);

ReceiptIcon.displayName = "ReceiptIcon";

export { ReceiptIcon };
