import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // `cursor-pointer` is explicit for parity with the design branch, where
  // Tailwind v4's Preflight sets `button { cursor: default }`. Under this
  // repo's Tailwind 3.4 Preflight `button, [role=button]` already get the
  // pointer, so here it is belt-and-braces. `disabled:pointer-events-none`
  // already suppresses the cursor on disabled buttons.
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:[&:not([aria-haspopup])]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-destructive/20 dark:aria-[invalid=true]:border-destructive/50 dark:aria-[invalid=true]:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // Hover, and the resting outline fill, go through `--v2-hover` and
        // `--v2-outline-fill` (team lead, Sep 16 2026: hovers are a light
        // purple tint, and buttons are never white). This Button also renders
        // for v1 tenants (notification bell, shared settings panels, support,
        // fines), and only `.v2-theme` defines those variables, so for v1 each
        // `var()` falls back to exactly the token and alpha it used before.
        outline:
          "border-border bg-[var(--v2-outline-fill,hsl(var(--background)))] hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))] aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-[hsl(var(--v2-hover,var(--input)_/_0.3))]",
        // The branch mixed `secondary` with 5% `foreground` via color-mix().
        // The theme's CSS variables hold bare HSL triples, so a colour function
        // fed one resolves to nothing here — a token-opacity step instead.
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[hsl(var(--v2-hover,var(--secondary)_/_0.8))] aria-expanded:bg-[hsl(var(--v2-hover,var(--secondary)))] aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))] aria-expanded:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)_/_0.5))]",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-[[data-icon=inline-end]]:pr-2.5 has-[[data-icon=inline-start]]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-[[data-icon=inline-end]]:pr-2 has-[[data-icon=inline-start]]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-[[data-icon=inline-end]]:pr-2 has-[[data-icon=inline-start]]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-[[data-icon=inline-end]]:pr-3 has-[[data-icon=inline-start]]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "default", size = "default", asChild = false, ...props },
    ref
  ) => {
    const Comp: React.ElementType = asChild ? Slot : "button"

    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
