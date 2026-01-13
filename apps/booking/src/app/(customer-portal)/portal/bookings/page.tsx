'use client';

import { useCustomerRentals, useCustomerRentalStats } from '@/hooks/use-customer-rentals';
import { RentalCard } from '@/components/customer-portal/RentalCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Car, DollarSign, History, CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

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

export default function CurrentBookingsPage() {
  const { data: rentals, isLoading } = useCustomerRentals('current');
  const { data: stats } = useCustomerRentalStats();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Bookings</h1>
          <p className="text-muted-foreground">
            View and manage your current rentals
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

      {/* Current Rentals */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Current Bookings</h2>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
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
        ) : rentals && rentals.length > 0 ? (
          <div className="space-y-4">
            {rentals.map((rental) => (
              <RentalCard key={rental.id} rental={rental} />
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Car className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No active bookings</h3>
            <p className="text-muted-foreground mb-4">
              You don't have any active rentals at the moment.
            </p>
            <Link href="/">
              <Button>Book a Vehicle</Button>
            </Link>
          </Card>
        )}
      </div>

      {/* Link to Past Bookings */}
      {stats && stats.pastRentals > 0 && (
        <div className="text-center pt-4">
          <Link href="/portal/bookings/history">
            <Button variant="outline">
              <History className="h-4 w-4 mr-2" />
              View Past Bookings ({stats.pastRentals})
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
