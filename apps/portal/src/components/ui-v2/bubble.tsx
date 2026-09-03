import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
// The upstream file imported `{ Slot } from "radix-ui"` — the unified package,
// which is not a dependency of this app. The individual package that IS
// installed exports the primitive directly, so `Slot.Root` becomes `Slot`.
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

/**
 * Chat bubble primitives.
 *
 * Ported from the v2 branch, which had migrated to Tailwind v4. This app is on
 * v3.4, so the v4-only syntax is re-expressed rather than carried over:
 *   `*:X:y`            → `[&>X]:y`          (direct-child variant)
 *   `wrap-break-word`  → `break-words`
 *   `ring-3`           → `ring-2`           (v3's ring scale is 0/1/2/4/8)
 *   `color-mix(in oklch, var(--secondary), …)` / `oklch(from var(--primary) …)`
 *                      → token opacity utilities. Portal's CSS variables hold
 *                        bare HSL triples, not colours, so `var(--primary)`
 *                        cannot be fed to a colour function — but `bg-primary/10`
 *                        resolves through the Tailwind theme and does.
 *
 * New file. Nothing in v1 imports it.
 */

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit min-w-0 max-w-[80%] flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full",
  {
    variants: {
      variant: {
        default:
          "[&>[data-slot=bubble-content]]:bg-primary [&>[data-slot=bubble-content]]:text-primary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80",
        secondary:
          "[&>[data-slot=bubble-content]]:bg-secondary [&>[data-slot=bubble-content]]:text-secondary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-secondary/80",
        muted:
          "[&>[data-slot=bubble-content]]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/70",
        tinted:
          "[&>[data-slot=bubble-content]]:bg-primary/10 [&>[data-slot=bubble-content]]:text-foreground dark:[&>[data-slot=bubble-content]]:bg-primary/25 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/30",
        outline:
          "[&>[data-slot=bubble-content]]:border-border [&>[data-slot=bubble-content]]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30",
        ghost:
          "border-none [&>[data-slot=bubble-content]]:rounded-none [&>[data-slot=bubble-content]]:bg-transparent [&>[data-slot=bubble-content]]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50",
        destructive:
          "[&>[data-slot=bubble-content]]:bg-destructive/10 [&>[data-slot=bubble-content]]:text-destructive dark:[&>[data-slot=bubble-content]]:bg-destructive/20 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end"
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  )
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
}) {
  // `React.ElementType` rather than the inferred union: this app is on
  // @radix-ui/react-slot 1.2, whose `SlotProps` is narrower than the full set
  // of div attributes being forwarded, so the union widens the call signature
  // to something neither branch accepts.
  const Comp: React.ElementType = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        "w-fit min-w-0 max-w-full overflow-hidden break-words rounded-3xl border border-transparent px-3.5 py-2.5 text-sm leading-relaxed group-data-[align=end]/bubble:self-end [&_a]:transition-colors [&_a]:outline-none [&_a:focus-visible]:border-ring [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring/30 [&_button]:text-left [&_button]:transition-colors [&_button]:outline-none [&_button:focus-visible]:border-ring [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ring/30",
        className
      )}
      {...props}
    />
  )
}

const bubbleReactionsVariants = cva(
  "absolute z-10 flex w-fit shrink-0 items-center justify-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-sm ring-2 ring-card has-[button]:p-0",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-3/4",
        bottom: "bottom-0 translate-y-3/4",
      },
      align: {
        start: "left-3",
        end: "right-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  }
)

function BubbleReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end"
  side?: "top" | "bottom"
}) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  )
}

export { BubbleGroup, Bubble, BubbleContent, BubbleReactions }
