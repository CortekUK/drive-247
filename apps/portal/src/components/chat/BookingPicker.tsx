'use client';

import { useState, useMemo } from 'react';
import { Paperclip, Search, Car, Calendar, X } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCustomerRentals, CustomerRental } from '@/hooks/use-customer-rentals';
import { cn } from '@/lib/utils';

export interface BookingReference {
  id: string;
  rentalNumber: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  vehicle: {
    make: string;
    model: string;
    reg: string;
  };
}

interface BookingPickerProps {
  customerId: string;
  onSelect: (booking: BookingReference) => void;
  disabled?: boolean;
}

function getStatusColor(status: string): string {
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

function formatRentalNumber(rental: CustomerRental): string {
  // Generate a rental number if not available
  const prefix = 'RNT';
  const idPart = rental.id.slice(0, 6).toUpperCase();
  return `${prefix}-${idPart}`;
}

export function BookingPicker({ customerId, onSelect, disabled }: BookingPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { data: rentals = [], isLoading } = useCustomerRentals(customerId);

  const filteredRentals = useMemo(() => {
    if (!searchQuery.trim()) return rentals;

    const query = searchQuery.toLowerCase();
    return rentals.filter((rental) => {
      const vehicleName = `${rental.vehicle?.make || ''} ${rental.vehicle?.model || ''}`.toLowerCase();
      const reg = rental.vehicle?.reg?.toLowerCase() || '';
      const rentalNumber = formatRentalNumber(rental).toLowerCase();
      const status = rental.status.toLowerCase();

      return (
        vehicleName.includes(query) ||
        reg.includes(query) ||
        rentalNumber.includes(query) ||
        status.includes(query)
      );
    });
  }, [rentals, searchQuery]);

  const handleSelect = (rental: CustomerRental) => {
    const bookingRef: BookingReference = {
      id: rental.id,
      rentalNumber: formatRentalNumber(rental),
      status: rental.status,
      startDate: rental.start_date,
      endDate: rental.end_date,
      vehicle: {
        make: rental.vehicle?.make || '',
        model: rental.vehicle?.model || '',
        reg: rental.vehicle?.reg || '',
      },
    };
    onSelect(bookingRef);
    setOpen(false);
    setSearchQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="h-[44px] w-[44px] shrink-0"
          title="Attach booking"
        >
          <Paperclip className="h-4 w-4" />
          <span className="sr-only">Attach booking</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        side="top"
        sideOffset={8}
      >
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search bookings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-[300px]">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Loading bookings...
            </div>
          ) : filteredRentals.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {searchQuery
                ? 'No bookings match your search'
                : 'No bookings found for this customer'}
            </div>
          ) : (
            <div className="p-1">
              {filteredRentals.map((rental) => (
                <button
                  key={rental.id}
                  onClick={() => handleSelect(rental)}
                  className={cn(
                    'w-full text-left p-3 rounded-md hover:bg-muted/50 transition-colors',
                    'focus:outline-none focus:bg-muted/50'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Car className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {rental.vehicle?.make} {rental.vehicle?.model}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] px-1.5 py-0', getStatusColor(rental.status))}
                        >
                          {rental.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatRentalNumber(rental)}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {rental.vehicle?.reg}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {format(new Date(rental.start_date), 'MMM d')}
                          {rental.end_date && (
                            <> - {format(new Date(rental.end_date), 'MMM d, yyyy')}</>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
