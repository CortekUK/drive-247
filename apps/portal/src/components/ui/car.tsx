"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface CarIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CarIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BODY_VARIANTS: Variants = {
  normal: { y: 0, rotate: 0 },
  animate: {
    y: [0, -1.5, 0.5, -0.5, 0],
    rotate: [0, -1, 0.5, 0],
    transition: { duration: 0.6, ease: "easeInOut" },
  },
};

const WHEEL_SPIN: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: [0, 360],
    transition: { duration: 0.6, ease: "easeInOut" },
  },
};

const AXLE_VARIANTS: Variants = {
  normal: { opacity: 1, scaleX: 1 },
  animate: {
    opacity: [0.6, 1],
    scaleX: [0.9, 1],
    transition: { duration: 0.3, ease: "easeOut", delay: 0.1 },
  },
};

const CarIcon = forwardRef<CarIconHandle, CarIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const wheelControls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => {
          controls.start("animate");
          wheelControls.start("animate");
        },
        stopAnimation: () => {
          controls.start("normal");
          wheelControls.start("normal");
        },
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
          wheelControls.start("animate");
        }
      },
      [controls, wheelControls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
          wheelControls.start("normal");
        }
      },
      [controls, wheelControls, onMouseLeave]
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
            {/* Car body */}
            <motion.path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
            {/* Axle */}
            <motion.line
              x1="9"
              x2="15"
              y1="17"
              y2="17"
              variants={AXLE_VARIANTS}
              initial="normal"
              animate={controls}
            />
          </motion.g>
          {/* Left wheel */}
          <motion.circle
            cx="7"
            cy="17"
            r="2"
            variants={WHEEL_SPIN}
            initial="normal"
            animate={wheelControls}
            style={{ transformOrigin: "7px 17px" }}
          />
          {/* Right wheel */}
          <motion.circle
            cx="17"
            cy="17"
            r="2"
            variants={WHEEL_SPIN}
            initial="normal"
            animate={wheelControls}
            style={{ transformOrigin: "17px 17px" }}
          />
        </motion.svg>
      </div>
    );
  }
);

CarIcon.displayName = "CarIcon";

export { CarIcon };
