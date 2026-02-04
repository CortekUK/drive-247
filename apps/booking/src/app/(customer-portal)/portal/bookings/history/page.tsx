'use client';

import { useState, useMemo } from 'react';
import { useCustomerRentals } from '@/hooks/use-customer-rentals';
import { RentalCard } from '@/components/customer-portal/RentalCard';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { History, ArrowLeft, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function BookingHistoryPage() {
  const { data: rentals, isLoading } = useCustomerRentals('past');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Sort rentals based on user selection
  const sortedRentals = useMemo(() => {
    if (!rentals) return [];
    return [...rentals].sort((a, b) => {
      const dateA = new Date(a.start_date).getTime();
      const dateB = new Date(b.start_date).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
  }, [rentals, sortOrder]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/portal/bookings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Booking History</h1>
          <p className="text-muted-foreground">
            View all your past rentals
          </p>
        </div>
      </div>

      {/* Sort Filter */}
      {rentals && rentals.length > 1 && (
        <div className="flex items-center justify-end gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <Select value={sortOrder} onValueChange={(value: 'newest' | 'oldest') => setSortOrder(value)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Most Recent First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Past Rentals */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="flex">
                <Skeleton className="w-48 h-32" />
                <div className="flex-1 p-4 space-y-2">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : sortedRentals && sortedRentals.length > 0 ? (
        <div className="space-y-4">
          {sortedRentals.map((rental) => (
            <RentalCard key={rental.id} rental={rental} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-2">No past bookings</h3>
          <p className="text-muted-foreground mb-4">
            Your completed rentals will appear here.
          </p>
          <Link href="/">
            <Button>Book a Vehicle</Button>
          </Link>
        </Card>
      )}
    </div>
  );
}
