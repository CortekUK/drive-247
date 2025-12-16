import * as React from "react";
import { cn } from "@/lib/utils";

interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  date: string;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "destructive";
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

const variantStyles = {
  default: "bg-muted text-muted-foreground",
  success: "bg-green-100 text-green-700 border-green-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  destructive: "bg-red-100 text-red-700 border-red-200",
};

export const Timeline = React.forwardRef<HTMLDivElement, TimelineProps>(
  ({ items, className }, ref) => {
    if (!items.length) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No activity recorded
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("space-y-4", className)}>
        {items.map((item, index) => (
          <div key={item.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border text-xs",
                  variantStyles[item.variant || "default"]
                )}
              >
                {item.icon || (index + 1)}
              </div>
              {index < items.length - 1 && (
                <div className="h-8 w-px bg-border mt-2" />
              )}
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{item.title}</h4>
                <time className="text-xs text-muted-foreground">
                  {new Date(item.date).toLocaleDateString()}
                </time>
              </div>
              {item.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {item.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
);

Timeline.displayName = "Timeline";

export type { TimelineItem };