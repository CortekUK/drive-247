import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Loading placeholder. Deliberately NOT shadcn's `bg-accent` — that token
 * resolves to the indigo tint, which appears nowhere on the shipped site.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-brand-stone/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
