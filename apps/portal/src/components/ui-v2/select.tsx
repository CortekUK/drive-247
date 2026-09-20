import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"

import { cn } from "@/lib/utils"
import { ChevronDown, Check, ChevronUp } from "lucide-react"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1.5 p-1.5", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 [&>[data-slot=select-value]]:line-clamp-1 [&>[data-slot=select-value]]:flex [&>[data-slot=select-value]]:items-center [&>[data-slot=select-value]]:gap-1.5 dark:aria-[invalid=true]:border-destructive/50 dark:aria-[invalid=true]:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  /**
   * The v2 dropdown is deliberately DARK — a translucent near-black panel over
   * a blur — and `dropdown-menu.tsx` matches it, so it is a style choice rather
   * than an accident. It reads as an OS menu on light, text-heavy screens
   * though, so a surface can opt into the page's own colours instead.
   *
   * Defaults to the dark panel, so every existing dropdown in the app is
   * byte-for-byte what it was.
   */
  tone = "dark",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  tone?: "dark" | "surface";
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-tone={tone}
        data-align-trigger={position === "item-aligned"}
        className={cn(
          // Item highlight reads `--v2-hover`, falling back to the old
          // `foreground/10` where it is undefined (v1 tenants). The dark panel
          // forces v1's `.dark` palette, where the page's light purple would be
          // a pale bar under ivory text and the stock `--accent-foreground` is
          // near-black; so the panel sets its own wash (violet-500/30 by
          // default: the brand hue +10° and saturation +22 points, at 66%, so it
          // follows a tenant's colour; with no --brand-* it is violet-500
          // exactly) and makes the highlighted label its own ivory.
          // `surface` sets no tokens of its own: it inherits the page's, and
          // both v2 modes were checked against `styles/v2-theme.css` rather
          // than assumed. Light — a white `--popover` panel, the 90% grey
          // `--border`, a light-purple `--v2-hover` bar under near-black
          // (9%) `--accent-foreground` text. Dark — the 9.1% panel, a 10%
          // white border, the 17% brand bar under ivory (98%) text. The check
          // mark follows the label either way (SelectItem paints every child
          // of a focused item `--accent-foreground`), so neither mode needs an
          // override here and none is added.
                                  tone === "dark" ? "dark bg-popover/70 [--v2-hover:calc(var(--brand-h,248)_+_10)_calc(var(--brand-s,68%)_+_22%)_66%_/_0.3] [--accent-foreground:var(--popover-foreground)]"
                                    : "border border-border bg-popover",
          "z-50 max-h-[var(--radix-select-content-available-height)] min-w-36 origin-[var(--radix-select-content-transform-origin)] overflow-x-hidden overflow-y-auto rounded-3xl text-popover-foreground shadow-lg ring-1 ring-foreground/5 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 !animate-none relative before:pointer-events-none before:absolute before:inset-0 before:-z-[1] before:rounded-[inherit] data-[tone=dark]:before:backdrop-blur-2xl data-[tone=dark]:before:backdrop-saturate-150 [&_[data-slot$=-item]:focus]:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))] [&_[data-slot$=-item][data-highlighted]]:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))] [&_[data-slot$=-separator]]:bg-foreground/5 [&_[data-variant=destructive]]:!text-accent-foreground [&_[data-variant=destructive]_*]:!text-accent-foreground",
                                  position === "popper" &&
                                    "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                                  className
                                )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "data-[position=popper]:h-[var(--radix-select-trigger-height)] data-[position=popper]:w-full data-[position=popper]:min-w-[var(--radix-select-trigger-width)]",
            position === "popper" && ""
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-3 py-2.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2.5 rounded-2xl py-2 pr-8 pl-3 text-sm font-medium outline-none select-none focus:bg-accent focus:text-accent-foreground [&:not([data-variant=destructive]):focus_*]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>span:last-child]:flex [&>span:last-child]:items-center [&>span:last-child]:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "pointer-events-none -mx-1.5 my-1.5 h-px bg-border",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUp
      />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDown
      />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
