"use client"

/**
 * The ui-v2 table (apps/portal/src/components/ui-v2/table.tsx, which now
 * re-exports this), shared with the customer portal. Colours are the shared
 * `v2-*` utilities, which fall back to the shadcn colour outside `.v2-theme`,
 * so every operator tenant, v1 or v2, renders it exactly as before. Rows carry
 * their border colour explicitly (`border-v2-border`) because the customer
 * site's Tailwind 4 base does not paint borders the shadcn colour.
 */

import * as React from "react"

import { cn } from "./cn"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-v2-border bg-v2-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  // One `hover:` class and no `dark:hover:` twin, so a call site's own
  // `hover:bg-transparent` (list headers) still replaces it in tailwind-merge.
  // `--v2-row-hover` / `--v2-hover` are the purple tints under `.v2-theme`;
  // elsewhere each falls back to the old `muted/50` / `muted`.
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-v2-border transition-colors hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))] has-[[aria-expanded=true]]:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))] data-[state=selected]:bg-[hsl(var(--v2-hover,var(--muted)))]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-12 px-3 text-left align-middle font-medium whitespace-nowrap text-v2-fg [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-v2-muted-fg", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
