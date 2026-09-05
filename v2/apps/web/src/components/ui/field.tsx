import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

/**
 * Framework-free field wrappers: label + control + description + error.
 * Use these when the value lives in local/zustand state. When the value lives
 * in react-hook-form, use `form.tsx` instead — it wires ids and aria-* from
 * the field's own validation state.
 */

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function Field({
  className,
  invalid = false,
  ...props
}: React.ComponentProps<"div"> & { invalid?: boolean }) {
  return (
    <div
      data-slot="field"
      data-invalid={invalid || undefined}
      className={cn("group/field flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

/** Label and control on one line — for switches and inline toggles. */
function FieldRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-row"
      className={cn("flex items-center justify-between gap-4", className)}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "text-sm font-medium text-brand-text group-data-[invalid]/field:text-danger",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-xs leading-relaxed text-brand-text-subtle", className)}
      {...props}
    />
  )
}

/** Renders nothing when there is no message, so callers can pass it freely. */
function FieldError({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  if (!children) return null

  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("text-xs leading-relaxed text-danger", className)}
      {...props}
    >
      {children}
    </p>
  )
}

export {
  Field,
  FieldGroup,
  FieldRow,
  FieldLabel,
  FieldDescription,
  FieldError,
}
