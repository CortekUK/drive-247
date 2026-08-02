"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "bg-muted relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      {/*
        The indicator is always full-width and slid into place with translateX
        rather than animated on `width`. Width animations are laid out on every
        frame; a transform is composited, so the bar stays smooth even while the
        onboarding boot screen is busy re-rendering milestone rows behind it.

        Radix types `value` as `number | null` — null means indeterminate. We
        collapse that to 0 (fully translated out of view) because this app has no
        indeterminate progress affordance; anything genuinely unknown shows a
        spinner instead.
      */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-indigo-600 dark:bg-indigo-500 h-full w-full flex-1 transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
