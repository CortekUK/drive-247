import { Skeleton } from '@nw/components/ui/skeleton';
import { CARD } from '@nw/site-v2/kit';
import { cn } from '@nw/lib/utils';

/** Card-shaped placeholder — same box model as the v2 `VehicleCard` (sections/vehicle-card.tsx), so nothing jumps. */
export function FleetCardSkeleton() {
  return (
    <div className={cn(CARD, 'flex flex-col p-3')}>
      <Skeleton className="aspect-[16/10] w-full rounded-xl bg-pv-tint" />
      <div className="px-1 pb-1 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3 bg-pv-tint" />
            <Skeleton className="h-3 w-1/2 bg-pv-tint" />
          </div>
          <Skeleton className="h-8 w-14 bg-pv-tint" />
        </div>
        <Skeleton className="mt-4 h-3 w-3/4 bg-pv-tint" />
      </div>
    </div>
  );
}

/** Row-shaped placeholder for the list view (one row inside the list panel). */
export function FleetRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center">
      <Skeleton className="aspect-[16/10] w-full rounded-xl bg-pv-tint md:aspect-auto md:h-[96px] md:w-[150px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3 bg-pv-tint" />
        <Skeleton className="h-3 w-1/4 bg-pv-tint" />
        <Skeleton className="h-3 w-2/3 bg-pv-tint" />
      </div>
      <div className="space-y-2 md:w-[180px]">
        <Skeleton className="h-6 w-20 bg-pv-tint" />
        <Skeleton className="h-9 w-full rounded-full bg-pv-tint" />
      </div>
    </div>
  );
}

export function FleetGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading vehicles" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <FleetCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function FleetListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading vehicles" className={cn(CARD, 'divide-y divide-pv-border overflow-hidden')}>
      {Array.from({ length: rows }, (_, index) => (
        <FleetRowSkeleton key={index} />
      ))}
    </div>
  );
}
