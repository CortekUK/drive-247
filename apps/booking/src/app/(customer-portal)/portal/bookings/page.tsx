'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useCustomerRentals, useCustomerRentalStats } from '@/hooks/use-customer-rentals';
import { useCustomerNotifications } from '@/hooks/use-customer-notifications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Car, DollarSign, History, CalendarCheck, ArrowUpDown, ChevronRight, Calendar, AlertCircle, Search, X, Clock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { format } from 'date-fns';

type BookingFilter = 'all' | 'active' | 'current' | 'past';
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium min-w-0 truncate">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardHeader>
      <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
        <div className="text-xl sm:text-2xl font-bold break-words">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function getStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'confirmed':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'pending':
    case 'pending_approval':
    case 'reserved':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'completed':
    case 'ended':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'cancelled':
    case 'canceled':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
  }
}

function formatDateShort(date: string | null): string {
  if (!date) return '-';
  try {
    return format(new Date(date), 'dd MMM yyyy');
  } catch {
    return '-';
  }
}

function formatDateTimeShort(date: string | null): string {
  if (!date) return '-';
  try {
    return format(new Date(date), 'dd MMM yyyy, HH:mm');
  } catch {
    return '-';
  }
}

export default function BookingsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<BookingFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [search, setSearch] = useState('');
  const { tenant } = useTenant();

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

  const getRef = (r: { rental_number?: string | null; id: string }) =>
    r.rental_number || r.id?.slice(0, 8).toUpperCase();

  // Sort by creation time (latest first by default) + filter by reference number.
  // We sort by created_at (when the booking was made) rather than start_date so
  // a just-booked future rental still shows at the top regardless of its status.
  const sortedRentals = useMemo(() => {
    if (!rentals) return [];
    const query = search.trim().toLowerCase();
    const filtered = query
      ? rentals.filter((r) => getRef(r).toLowerCase().includes(query))
      : rentals;
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.created_at || a.start_date).getTime();
      const dateB = new Date(b.created_at || b.start_date).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
  }, [rentals, sortOrder, search]);

  const getEmptyMessage = () => {
    switch (filter) {
      case 'active':
        return { title: 'No active bookings', description: "You don't have any active rentals at the moment." };
      case 'current':
        return { title: 'No current bookings', description: "You don't have any current rentals at the moment." };
      case 'past':
        return { title: 'No past bookings', description: 'Your completed rentals will appear here.' };
      default:
        return { title: 'No bookings yet', description: "You haven't made any bookings yet." };
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">My Bookings</h1>
          <p className="text-sm sm:text-base text-muted-foreground">View and manage your rentals</p>
        </div>
        <Link href="/" className="w-full sm:w-auto">
          <Button className="w-full sm:w-auto">
            <Car className="h-4 w-4 mr-2" />
            Book a Vehicle
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard title="Active Rentals" value={stats?.currentRentals || 0} icon={Car} />
        <StatCard title="Total Rentals" value={stats?.totalRentals || 0} icon={CalendarCheck} />
        <StatCard title="Past Rentals" value={stats?.pastRentals || 0} icon={History} />
        <StatCard
          title="Total Spent"
          value={formatCurrency(stats?.totalSpent || 0, tenant?.currency_code || 'USD')}
          icon={DollarSign}
        />
      </div>

      {/* Tabs, Search, Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as BookingFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="current">Current</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by reference..."
              className="h-9 pl-8 pr-8 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

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
      </div>

      {/* Bookings List */}
      <div>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
                <Skeleton className="h-12 w-12 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : sortedRentals && sortedRentals.length > 0 ? (
          <div className="border rounded-lg divide-y">
            {sortedRentals.map((rental) => {
              const vehicle = rental.vehicles;
              const vehicleName = vehicle
                ? `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || vehicle.reg
                : 'Unknown Vehicle';
              const photoUrl = vehicle?.photo_url || vehicle?.vehicle_photos?.[0]?.photo_url;
              const hasInsuranceAlert = insuranceReuploadRentalIds.has(rental.id);
              const needsSignature = rental.document_status === 'sent' || rental.document_status === 'delivered';
              const hasPendingExtension = rental.is_extended && rental.extension_checkout_url;

              return (
                <div
                  key={rental.id}
                  className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/portal/bookings/${rental.id}`)}
                >
                  {/* Vehicle thumbnail */}
                  <div className="h-12 w-16 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={vehicleName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Car className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums">
                        #{getRef(rental)}
                      </span>
                      <p className="font-medium truncate">{vehicleName}</p>
                      {vehicle?.reg && (
                        <span className="text-xs text-muted-foreground hidden sm:inline">{vehicle.reg}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateShort(rental.start_date)} — {formatDateShort(rental.end_date)}
                      </span>
                      {rental.created_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Booked {formatDateTimeShort(rental.created_at)}
                        </span>
                      )}
                      <span className="hidden sm:inline">
                        {formatCurrency(rental.monthly_amount || 0, tenant?.currency_code || 'USD')}
                      </span>
                    </div>
                  </div>

                  {/* Alerts */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasInsuranceAlert && (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                    {needsSignature && (
                      <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800 hidden sm:inline-flex">
                        Sign Agreement
                      </Badge>
                    )}
                    {hasPendingExtension && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800 hidden sm:inline-flex">
                        Extension Pending
                      </Badge>
                    )}
                  </div>

                  {/* Status + chevron */}
                  <Badge className={`${getStatusColor(rental.status)} flex-shrink-0`}>
                    {rental.status?.replace(/_/g, ' ')}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              );
            })}
          </div>
        ) : search.trim() && rentals && rentals.length > 0 ? (
          <Card className="p-8 text-center">
            <Search className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold text-lg mb-2">No matches for “{search}”</h3>
            <p className="text-muted-foreground mb-4">Try a different reference number or clear the search.</p>
            <Button variant="outline" onClick={() => setSearch('')}>Clear search</Button>
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <Car className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">{getEmptyMessage().title}</h3>
            <p className="text-muted-foreground mb-4">{getEmptyMessage().description}</p>
            <Link href="/">
              <Button>Book a Vehicle</Button>
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
