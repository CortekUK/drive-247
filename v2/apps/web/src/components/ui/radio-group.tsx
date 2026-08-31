"use client"

import * as React from "react"
import { CircleIcon } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2.5", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "aspect-square size-4 shrink-0 rounded-full border border-brand-border text-brand-forest shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-brand-forest focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 data-[state=checked]:border-brand-forest",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-brand-forest stroke-brand-forest" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

/**
 * A whole-row selectable card — what the booking sidebar actually needs for
 * coverage tiers / delivery method, rather than a bare dot + label.
 */
function RadioGroupCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-card"
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 rounded-[14px] border border-brand-border-soft bg-brand-card p-4 text-left transition-all outline-none hover:border-brand-border focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand-forest data-[state=checked]:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.18)]",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-brand-border transition-colors group-data-[state=checked]:border-brand-forest"
      >
        <span className="size-2 rounded-full bg-brand-forest opacity-0 transition-opacity group-data-[state=checked]:opacity-100" />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupCard }
