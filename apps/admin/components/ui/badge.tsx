import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // v2 pills: tinted surface, coloured ink, no border and no halo. The ink was
  // pinned to the -400 end of each ramp, which is the value that reads on a
  // near-black canvas and washes out on a light one; each now takes the theme
  // token, so the pills follow :root and .dark like the rest of the app.
  "inline-flex items-center rounded-3xl border border-transparent px-2.5 py-0.5 text-[11px] font-semibold transition-all focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
  {
    variants: {
      variant: {
        default:
          "bg-primary/10 text-primary",
        secondary:
          "bg-secondary text-secondary-foreground",
        destructive:
          "bg-destructive/10 text-destructive",
        outline:
          "border-border text-foreground",
        success:
          "bg-success/10 text-success",
        warning:
          "bg-warning/15 text-warning",
        // No token for "info" in the v2 set; sky is the nearest thing and is
        // written per-mode because a single value cannot carry both — the -400
        // step that reads on dark is unreadable on white.
        info:
          "bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
