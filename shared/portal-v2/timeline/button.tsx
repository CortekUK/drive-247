"use client";

/**
 * The operator ui-v2 Button as the rentals timeline uses it: the same element
 * and data attributes, painted with the shared looks (button-styles.ts, which
 * shared-v2-copies.test.ts recomputes from the operator Button). Only the
 * variant / size pairs the board draws exist here.
 */

import { forwardRef, type ComponentProps } from "react";
import { cn } from "../cn";
import {
  V2_BUTTON_DEFAULT_SM,
  V2_BUTTON_GHOST_ICON_SM,
  V2_BUTTON_GHOST_SM,
  V2_BUTTON_OUTLINE_ICON_SM,
  V2_BUTTON_OUTLINE_SM,
} from "../button-styles";

const LOOKS = {
  "default/sm": V2_BUTTON_DEFAULT_SM,
  "outline/sm": V2_BUTTON_OUTLINE_SM,
  "outline/icon-sm": V2_BUTTON_OUTLINE_ICON_SM,
  "ghost/sm": V2_BUTTON_GHOST_SM,
  "ghost/icon-sm": V2_BUTTON_GHOST_ICON_SM,
} as const;

type Look = keyof typeof LOOKS;
type Variant = Look extends `${infer V}/${string}` ? V : never;
type Size = Look extends `${string}/${infer S}` ? S : never;

export const Button = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { variant?: Variant; size?: Size }
>(function Button({ className, variant = "default", size = "sm", ...props }, ref) {
  return (
    <button
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(LOOKS[`${variant}/${size}` as Look], className)}
      {...props}
    />
  );
});
