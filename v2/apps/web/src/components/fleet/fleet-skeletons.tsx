import { Skeleton } from '@/components/ui/skeleton';

/** Card-shaped placeholder — same box model as `VehicleCard`, so nothing jumps. */
export function FleetCardSkeleton() {
  return (
    <div className="flex flex-col rounded-[14px] border border-brand-border-soft bg-white p-4">
      <Skeleton className="aspect-[16/10] w-full rounded-[10px]" />
      <Skeleton className="mt-3 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <Skeleton className="mt-4 h-3 w-3/4" />
      <div className="mt-5 flex items-end justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
    </div>
  );
}

/** Row-shaped placeholder for the list view. */
export function FleetRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-[14px] border border-brand-border-soft bg-white p-4 md:flex-row">
      <Skeleton className="aspect-[16/10] w-full rounded-[10px] md:aspect-auto md:h-[136px] md:w-[34%] md:max-w-[200px] xl:max-w-[220px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="space-y-2 md:w-[170px] xl:w-[200px]">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-full rounded-full" />
      </div>
    </div>
  );
}

export function FleetGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading vehicles"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: count }, (_, index) => (
        <FleetCardSkeleton key={index} />
      ))}
    </div>
  );
}
