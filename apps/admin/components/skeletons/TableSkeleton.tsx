import { Skeleton } from "@/components/ui/skeleton";

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
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          {title ? (
            <>
              <h1 className="text-3xl font-bold text-white">{title}</h1>
              {subtitle && <p className="mt-2 text-gray-400">{subtitle}</p>}
            </>
          ) : (
            <>
              <Skeleton className="h-9 w-48 mb-2" />
              <Skeleton className="h-5 w-72" />
            </>
          )}
        </div>
        {showButton && <Skeleton className="h-12 w-40 rounded-lg" />}
      </div>

      {/* Table */}
      <div className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border">
        {/* Table Header */}
        <div className="bg-dark-bg px-6 py-3 flex gap-4">
          {[...Array(columns)].map((_, i) => (
            <Skeleton
              key={i}
              className="h-4"
              style={{ flex: i === 0 ? 2 : 1 }}
            />
          ))}
        </div>

        {/* Table Body */}
        <div className="divide-y divide-dark-border">
          {[...Array(rows)].map((_, rowIdx) => (
            <div key={rowIdx} className="px-6 py-4 flex gap-4 items-center">
              {[...Array(columns)].map((_, colIdx) => (
                <Skeleton
                  key={colIdx}
                  className="h-5"
                  style={{ flex: colIdx === 0 ? 2 : 1 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
