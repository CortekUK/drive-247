"use client"

import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Toast mount. Colours come from the real design tokens rather than sonner's
 * defaults, so a toast reads as part of the site and not as a stock widget.
 * The site ships light-only (no ThemeProvider is mounted), hence theme="light".
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-right"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--brand-card)",
          "--normal-text": "var(--brand-text)",
          "--normal-border": "var(--brand-border-soft)",
          "--success-bg": "var(--extra-green-50)",
          "--success-text": "var(--extra-green-600)",
          "--success-border": "var(--extra-green-400)",
          "--error-bg": "var(--extra-red-50)",
          "--error-text": "var(--extra-red-600)",
          "--error-border": "var(--extra-red-400)",
          "--warning-bg": "var(--extra-yellow-50)",
          "--warning-text": "var(--extra-yellow-600)",
          "--warning-border": "var(--extra-yellow-400)",
          "--info-bg": "var(--extra-blue-50)",
          "--info-text": "var(--extra-blue-600)",
          "--info-border": "var(--extra-blue-400)",
          "--border-radius": "14px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
