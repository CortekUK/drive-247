'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { RentalConflict, ExternalConflict } from '@/hooks/use-rental-conflicts';

interface VehicleConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalConflicts: RentalConflict[];
  externalConflicts?: ExternalConflict[];
  onRetry: () => void;
  isRetrying?: boolean;
  /**
   * Optional copy overrides. Default copy is for the submit-time
   * "must resolve before saving" flow. The vehicle-change flow passes
   * different labels because the user has a real choice (clear / keep).
   */
  title?: string;
  description?: string;
  primaryLabel?: string;   // primary action button (default "Check Again")
  secondaryLabel?: string; // secondary action button (default "Cancel")
}

export function VehicleConflictDialog({
  open,
  onOpenChange,
  rentalConflicts,
  externalConflicts = [],
  onRetry,
  isRetrying,
  title = 'Vehicle Has Scheduling Conflicts',
  description = 'Resolve these conflicts before creating the rental.',
  primaryLabel = 'Check Again',
  secondaryLabel = 'Cancel',
}: VehicleConflictDialogProps) {
  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'MMM dd, yyyy');
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-base font-medium text-[#080812]">
                {title}
              </DialogTitle>
              <DialogDescription className="text-sm text-[#737373]">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {rentalConflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">
                Overlapping Rentals
              </p>
              {rentalConflicts.map((conflict) => (
                <div
                  key={conflict.id}
                  className="flex items-center justify-between rounded-md border border-[#f1f5f9] bg-[#f8fafc] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#080812] truncate">
                      {conflict.customerName}
                    </p>
                    <p className="text-xs text-[#737373]">
                      {formatDate(conflict.start_date)} — {conflict.end_date ? formatDate(conflict.end_date) : 'Ongoing'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <Badge
                      className={
                        conflict.status === 'Active'
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-amber-100 text-amber-700 border-amber-200'
                      }
                    >
                      {conflict.status}
                    </Badge>
                    <a
                      href={`/rentals/${conflict.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#6366f1] hover:bg-[#e0e7ff] transition-colors"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {externalConflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">
                External Bookings (Synced from Turo / Airbnb)
              </p>
              {externalConflicts.map((conflict) => {
                const sourceLabel = conflict.source.charAt(0).toUpperCase() + conflict.source.slice(1);
                return (
                  <div
                    key={conflict.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#080812] truncate">
                        {sourceLabel}{conflict.summary ? ` · ${conflict.summary}` : ''}
                      </p>
                      <p className="text-xs text-[#737373]">
                        {formatDate(conflict.start_date)} — {formatDate(conflict.end_date)}
                      </p>
                    </div>
                    <Badge className="bg-slate-200 text-slate-700 border-slate-300">
                      {sourceLabel}
                    </Badge>
                  </div>
                );
              })}
              <p className="text-xs text-[#737373]">
                This vehicle is already booked on the external platform. Cancel on that platform first to proceed.
              </p>
            </div>
          )}

        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRetrying}>
            {secondaryLabel}
          </Button>
          <Button onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              primaryLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
