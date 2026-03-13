import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  title?: string;
  subtitle?: string;
  showButton?: boolean;
}

export function TableSkeleton({
  rows = 5,
  columns = 6,
  title,
  subtitle,
  showButton = true,
}: TableSkeletonProps) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          {title ? (
            <>
              <h1 className="text-2xl font-bold">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-4 w-72" />
            </>
          )}
        </div>
        {showButton && <Skeleton className="h-10 w-40" />}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Header */}
          <div className="border-b px-4 py-3 flex gap-4">
            {Array.from({ length: columns }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-4"
                style={{ flex: i === 0 ? 2 : 1 }}
              />
            ))}
          </div>

          {/* Rows */}
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <div key={rowIdx} className="px-4 py-3 flex gap-4 items-center border-b last:border-0">
              {Array.from({ length: columns }).map((_, colIdx) => (
                <Skeleton
                  key={colIdx}
                  className="h-5"
                  style={{ flex: colIdx === 0 ? 2 : 1 }}
                />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
