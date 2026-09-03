import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Message layout primitives — the row an avatar, bubbles and their meta sit in.
 *
 * Ported from the v2 branch, which had migrated to Tailwind v4. This app is on
 * v3.4, so the v4-only syntax is re-expressed rather than carried over:
 *   `wrap-break-word`      → `break-words`
 *   `group-has-data-[k=v]` → `group-has-[[data-k=v]]`
 *   `*:data-slot:z`        → `[&>*[data-slot]]:z`   (direct-child variant)
 *
 * New file. Nothing in v1 imports it.
 */

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse",
        className
      )}
      {...props}
    />
  )
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-[[data-slot=message-footer]]/message:-translate-y-8",
        className
      )}
      {...props}
    />
  )
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col gap-2.5 break-words group-data-[align=end]/message:[&>*[data-slot]]:self-end",
        className
      )}
      {...props}
    />
  )
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex min-w-0 max-w-full items-center px-3.5 text-xs font-medium text-muted-foreground group-has-[[data-variant=ghost]]/message:px-0",
        className
      )}
      {...props}
    />
  )
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex min-w-0 max-w-full items-center px-3.5 text-xs font-medium text-muted-foreground group-data-[align=end]/message:justify-end group-has-[[data-variant=ghost]]/message:px-0",
        className
      )}
      {...props}
    />
  )
}

export {
  MessageGroup,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
}
