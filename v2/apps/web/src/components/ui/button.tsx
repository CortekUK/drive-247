import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Brand note — the shipped Drive247 site has NO indigo in it.
 * `default` (bg-primary / #6366f1) is kept only so pre-existing shadcn call
 * sites keep compiling; it must not be used on any customer-facing surface.
 * Reach for `brand` (the dark green "Rent a Car" pill) instead.
 * See src/lib/design-tokens.md.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",

        /* ── Brand pills — the real Drive247 palette ─────────────────────── */
        brand:
          "bg-brand-forest text-white hover:opacity-90 focus-visible:border-brand-forest focus-visible:ring-brand-forest/35",
        "brand-deep":
          "bg-brand-forest-deep text-white shadow-[0px_1px_1px_rgba(0,0,0,0.05)] hover:opacity-90 focus-visible:border-brand-forest-deep focus-visible:ring-brand-forest-deep/35",
        "brand-accent":
          "bg-brand-amber text-brand-text hover:opacity-90 focus-visible:border-brand-gold focus-visible:ring-brand-gold/40",
        "brand-outline":
          "border border-brand-border bg-brand-card text-brand-text hover:bg-brand-stone focus-visible:border-brand-forest focus-visible:ring-brand-forest/25",
        "brand-ghost":
          "text-brand-text-soft hover:bg-brand-stone hover:text-brand-text focus-visible:border-brand-forest focus-visible:ring-brand-forest/25",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        xl: "h-12 px-8 has-[>svg]:px-6",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    /**
     * Radius lives here, not in the variant, because several `size` values
     * hardcode `rounded-md` and cva emits sizes after variants — a brand pill
     * at size="lg" would otherwise come out square.
     */
    compoundVariants: [
      {
        variant: [
          "brand",
          "brand-deep",
          "brand-accent",
          "brand-outline",
          "brand-ghost",
        ],
        class: "rounded-full",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
