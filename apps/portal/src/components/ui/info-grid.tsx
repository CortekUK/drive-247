import * as React from "react";
import { cn } from "@/lib/utils";

interface InfoGridItem {
  label: string;
  value: string | React.ReactNode;
  link?: string;
  onClick?: () => void;
}

interface InfoGridProps {
  items: InfoGridItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}

export const InfoGrid = React.forwardRef<HTMLDivElement, InfoGridProps>(
  ({ items, columns = 3, className }, ref) => {
    const gridCols = {
      2: "grid-cols-2",
      3: "grid-cols-2 md:grid-cols-3",
      4: "grid-cols-2 md:grid-cols-4",
    };

    return (
      <div
        ref={ref}
        className={cn(`grid gap-4 ${gridCols[columns]}`, className)}
      >
        {items.map((item, index) => (
          <div key={index} className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              {item.label}
            </p>
            {item.link || item.onClick ? (
              <button
                onClick={item.onClick}
                className="text-left font-medium text-primary hover:underline"
              >
                {item.value}
              </button>
            ) : (
              <p className="font-medium">{item.value}</p>
            )}
          </div>
        ))}
      </div>
    );
  }
);

InfoGrid.displayName = "InfoGrid";