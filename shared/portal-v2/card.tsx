/**
 * The ui-v2 card (apps/portal/src/components/ui-v2/card.tsx, which now
 * re-exports this), shared with the customer portal. Colours are the shared
 * `v2-*` utilities, which fall back to the shadcn colour outside `.v2-theme`.
 * The radius is written as the value the operator's `rounded-4xl` already
 * resolves to (tailwind.config.ts: `var(--v2-radius-4xl, 2rem)`), because the
 * customer site's Tailwind 4 has its own, different `rounded-4xl`.
 */

import * as React from "react"

import { cn } from "./cn"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-[var(--card-spacing)] overflow-hidden rounded-[var(--v2-radius-4xl,2rem)] bg-v2-card py-[var(--card-spacing)] text-sm text-v2-card-fg shadow-md ring-1 ring-v2-fg/5 [--card-spacing:1.5rem] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:1rem] dark:ring-v2-fg/10 [&>img:first-child]:rounded-t-[var(--v2-radius-4xl,2rem)] [&>img:last-child]:rounded-b-[var(--v2-radius-4xl,2rem)]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header grid auto-rows-min items-start gap-1.5 rounded-t-[var(--v2-radius-4xl,2rem)] px-[var(--card-spacing)] has-[[data-slot=card-action]]:grid-cols-[1fr_auto] has-[[data-slot=card-description]]:grid-rows-[auto_auto] [&.border-b]:pb-[var(--card-spacing)]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-v2-muted-fg", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-[var(--card-spacing)]", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-[var(--v2-radius-4xl,2rem)] px-[var(--card-spacing)] [&.border-t]:pt-[var(--card-spacing)]",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
