import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { PAGE_HEADER, PAGE_HEADER_TEXT, PAGE_TITLE, PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { cn } from '@/lib/utils';

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
      <div className={cn('flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center', PAGE_HEADER)}>
        <div className={PAGE_HEADER_TEXT}>
          {title ? (
            <>
              <h1 className={cn('text-2xl sm:text-3xl font-bold tracking-tight', PAGE_TITLE)}>{title}</h1>
              {subtitle && <p className={cn('text-sm text-muted-foreground mt-1', PAGE_DESCRIPTION)}>{subtitle}</p>}
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-4 w-full max-w-72" />
            </>
          )}
        </div>
        {showButton && <Skeleton className="h-8 w-28 rounded-full sm:h-10 sm:w-40 max-sm:justify-self-end" />}
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
