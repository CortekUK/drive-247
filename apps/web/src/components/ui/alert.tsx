import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  // Two-column grid so a leading icon and the text block share one baseline.
  // The `has-[>svg]` pair swaps the icon gutter in and out: with no icon the
  // first column collapses to 0 and the text sits flush left, so an iconless
  // alert needs no separate variant.
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        // apps/web has exactly one error red — `text-red-600 dark:text-red-400`,
        // the same pair used for inline field errors. Deliberately NOT the
        // `destructive` token, which is a different hue and would give the site
        // two competing reds.
        destructive:
          "border-red-200/60 bg-red-50/50 text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400",
        // Indigo is the site accent. The icon is tinted explicitly here because
        // the body text stays `text-foreground` for readability on the tint.
        info: "border-indigo-200/60 bg-indigo-50/30 text-foreground dark:border-indigo-800/30 dark:bg-indigo-950/20 [&>svg]:text-indigo-600 dark:[&>svg]:text-indigo-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role="alert"
      // Badge's merge order, not Button's: `className` is merged OUTSIDE cva so
      // a caller's utility reliably wins the twMerge conflict resolution.
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
