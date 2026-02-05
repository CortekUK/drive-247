'use client';

import { useRouter } from 'next/navigation';
import { Car, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BookingReference } from './BookingPicker';

interface BookingReferenceCardProps {
  booking: BookingReference;
  isOwnMessage: boolean;
}

function getStatusColor(status: string, isOwnMessage: boolean): string {
  if (isOwnMessage) {
    // For own messages (primary background), use lighter colors
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-green-400/30 text-green-100 border-green-400/50';
      case 'pending':
      case 'reserved':
        return 'bg-yellow-400/30 text-yellow-100 border-yellow-400/50';
      case 'completed':
      case 'ended':
        return 'bg-white/20 text-white/90 border-white/30';
      case 'cancelled':
        return 'bg-red-400/30 text-red-100 border-red-400/50';
      default:
        return 'bg-white/20 text-white/90 border-white/30';
    }
  }

  // For received messages (muted background)
  switch (status.toLowerCase()) {
    case 'active':
      return 'bg-green-500/15 text-green-700 border-green-200';
    case 'pending':
    case 'reserved':
      return 'bg-yellow-500/15 text-yellow-700 border-yellow-200';
    case 'completed':
    case 'ended':
      return 'bg-gray-500/15 text-gray-700 border-gray-200';
    case 'cancelled':
      return 'bg-red-500/15 text-red-700 border-red-200';
    default:
      return 'bg-gray-500/15 text-gray-700 border-gray-200';
  }
}

export function BookingReferenceCard({ booking, isOwnMessage }: BookingReferenceCardProps) {
  const router = useRouter();

  const handleClick = () => {
    // Navigate to rental detail page in admin portal
    router.push(`/rentals/${booking.id}`);
  };

  const vehicleName = [booking.vehicle.make, booking.vehicle.model]
    .filter(Boolean)
    .join(' ') || 'Vehicle';

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left mt-2 p-2.5 rounded-lg transition-all',
        'border hover:scale-[1.01] active:scale-[0.99]',
        isOwnMessage
          ? 'bg-white/10 border-white/20 hover:bg-white/15'
          : 'bg-background/50 border-border/50 hover:bg-background/80'
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            isOwnMessage ? 'bg-white/20' : 'bg-muted'
          )}
        >
          <Car
            className={cn(
              'h-4 w-4',
              isOwnMessage ? 'text-white/80' : 'text-muted-foreground'
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'font-medium text-sm truncate',
                isOwnMessage ? 'text-white' : 'text-foreground'
              )}
            >
              {vehicleName}
            </span>
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', getStatusColor(booking.status, isOwnMessage))}
            >
              {booking.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {booking.rentalNumber && (
              <>
                <span
                  className={cn(
                    'text-xs',
                    isOwnMessage ? 'text-white/70' : 'text-muted-foreground'
                  )}
                >
                  {booking.rentalNumber}
                </span>
                <span className={isOwnMessage ? 'text-white/50' : 'text-muted-foreground'}>
                  ·
                </span>
              </>
            )}
            <span
              className={cn(
                'text-xs',
                isOwnMessage ? 'text-white/70' : 'text-muted-foreground'
              )}
            >
              {booking.vehicle.reg}
            </span>
          </div>
          <div
            className={cn(
              'flex items-center gap-1.5 mt-1 text-xs',
              isOwnMessage ? 'text-white/70' : 'text-muted-foreground'
            )}
          >
            <Calendar className="h-3 w-3" />
            <span>
              {format(new Date(booking.startDate), 'MMM d')}
              {booking.endDate && (
                <> - {format(new Date(booking.endDate), 'MMM d, yyyy')}</>
              )}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
