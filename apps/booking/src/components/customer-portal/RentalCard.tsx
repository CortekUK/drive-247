'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Car, MapPin } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { CustomerRental } from '@/hooks/use-customer-rentals';

interface RentalCardProps {
  rental: CustomerRental;
}

function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'Active':
      return 'default';
    case 'Pending':
    case 'Reserved':
      return 'secondary';
    case 'Completed':
    case 'Ended':
      return 'outline';
    case 'Cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function RentalCard({ rental }: RentalCardProps) {
  const vehicle = rental.vehicles;
  const vehicleName = vehicle
    ? vehicle.make && vehicle.model
      ? `${vehicle.make} ${vehicle.model}`
      : vehicle.reg
    : 'Vehicle';

  const vehicleImage =
    vehicle?.photo_url ||
    vehicle?.vehicle_photos?.[0]?.photo_url ||
    '/placeholder.svg';

  const durationDays = differenceInDays(
    new Date(rental.end_date),
    new Date(rental.start_date)
  );

  const formatDuration = (days: number): string => {
    if (days >= 30) {
      const months = Math.floor(days / 30);
      const remainingDays = days % 30;
      return remainingDays > 0
        ? `${months} month${months > 1 ? 's' : ''} ${remainingDays} day${remainingDays > 1 ? 's' : ''}`
        : `${months} month${months > 1 ? 's' : ''}`;
    }
    if (days >= 7) {
      const weeks = Math.floor(days / 7);
      const remainingDays = days % 7;
      return remainingDays > 0
        ? `${weeks} week${weeks > 1 ? 's' : ''} ${remainingDays} day${remainingDays > 1 ? 's' : ''}`
        : `${weeks} week${weeks > 1 ? 's' : ''}`;
    }
    return `${days} day${days > 1 ? 's' : ''}`;
  };

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row">
        {/* Vehicle Image */}
        <div className="sm:w-48 h-32 sm:h-auto bg-muted">
          <img
            src={vehicleImage}
            alt={vehicleName}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder.svg';
            }}
          />
        </div>

        {/* Content */}
        <div className="flex-1">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-lg">{vehicleName}</h3>
                {vehicle?.reg && (
                  <p className="text-sm text-muted-foreground">
                    {vehicle.colour && `${vehicle.colour} • `}
                    {vehicle.reg}
                  </p>
                )}
              </div>
              <Badge variant={getStatusBadgeVariant(rental.status)}>
                {rental.status}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="grid gap-2 text-sm">
              {/* Dates */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  {format(new Date(rental.start_date), 'MMM dd, yyyy')} -{' '}
                  {format(new Date(rental.end_date), 'MMM dd, yyyy')}
                </span>
              </div>

              {/* Duration */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Car className="h-4 w-4" />
                <span>{formatDuration(durationDays)}</span>
              </div>

              {/* Location */}
              {rental.pickup_location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span className="truncate">{rental.pickup_location}</span>
                </div>
              )}

              {/* Amount */}
              <div className="pt-2 flex items-center justify-between border-t mt-2">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-lg">
                  ${rental.monthly_amount?.toLocaleString() || '0'}
                </span>
              </div>
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
