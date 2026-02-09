'use client';

import { useState, useMemo } from 'react';
import { useCustomerRentals, useCustomerRentalStats } from '@/hooks/use-customer-rentals';
import { useCustomerNotifications } from '@/hooks/use-customer-notifications';
import { RentalCard } from '@/components/customer-portal/RentalCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Car, DollarSign, History, CalendarCheck, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type BookingFilter = 'all' | 'current' | 'past';
type SortOrder = 'newest' | 'oldest';

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function BookingsPage() {
  const [filter, setFilter] = useState<BookingFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const { data: rentals, isLoading } = useCustomerRentals(filter);
  const { data: stats } = useCustomerRentalStats();
  const { notifications } = useCustomerNotifications();

  // Extract rental IDs that have unread insurance_reupload notifications
  const insuranceReuploadRentalIds = useMemo(() => {
    const ids = new Set<string>();
    notifications
      .filter((n) => n.type === 'insurance_reupload' && !n.is_read)
      .forEach((n) => {
        const rentalId = (n.metadata as Record<string, unknown>)?.rental_id;
        if (typeof rentalId === 'string') ids.add(rentalId);
      });
    return ids;
  }, [notifications]);

  // Sort rentals based on user selection
  const sortedRentals = useMemo(() => {
    if (!rentals) return [];
    return [...rentals].sort((a, b) => {
      const dateA = new Date(a.start_date).getTime();
      const dateB = new Date(b.start_date).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
  }, [rentals, sortOrder]);

  const getEmptyMessage = () => {
    switch (filter) {
      case 'current':
        return {
          title: 'No active bookings',
          description: "You don't have any active rentals at the moment.",
        };
      case 'past':
        return {
          title: 'No past bookings',
          description: 'Your completed rentals will appear here.',
        };
      default:
        return {
          title: 'No bookings yet',
          description: "You haven't made any bookings yet.",
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Bookings</h1>
          <p className="text-muted-foreground">
            View and manage your rentals
          </p>
        </div>
        <Link href="/">
          <Button>
            <Car className="h-4 w-4 mr-2" />
            Book a Vehicle
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Rentals"
          value={stats?.currentRentals || 0}
          icon={Car}
        />
        <StatCard
          title="Total Rentals"
          value={stats?.totalRentals || 0}
          icon={CalendarCheck}
        />
        <StatCard
          title="Past Rentals"
          value={stats?.pastRentals || 0}
          icon={History}
        />
        <StatCard
          title="Total Spent"
          value={`$${(stats?.totalSpent || 0).toLocaleString()}`}
          icon={DollarSign}
        />
      </div>

      {/* Tabs and Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as BookingFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="current">Current</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Sort */}
        {rentals && rentals.length > 1 && (
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            <Select value={sortOrder} onValueChange={(value: SortOrder) => setSortOrder(value)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Bookings List */}
      <div>
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
              <RentalCard key={rental.id} rental={rental} insuranceReuploadRequired={insuranceReuploadRentalIds.has(rental.id)} />
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Car className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">{getEmptyMessage().title}</h3>
            <p className="text-muted-foreground mb-4">
              {getEmptyMessage().description}
            </p>
            <Link href="/">
              <Button>Book a Vehicle</Button>
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
