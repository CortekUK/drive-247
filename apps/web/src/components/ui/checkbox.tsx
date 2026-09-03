"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // `peer` is load-bearing: the adjacent <Label> dims itself via
        // `peer-disabled:*`, which only works while this stays the labelled
        // control's previous sibling.
        "peer border-input size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none data-[state=checked]:border-indigo-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:text-white dark:data-[state=checked]:border-indigo-500 dark:data-[state=checked]:bg-indigo-500 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      {/*
        `text-current` inherits the white set by `data-[state=checked]:text-white`
        on the root, so the tick tracks the checked colour without repeating it.
        `transition-none` keeps the tick from fading in a frame behind the box
        fill, which reads as a lag on the terms checkbox.
      */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
