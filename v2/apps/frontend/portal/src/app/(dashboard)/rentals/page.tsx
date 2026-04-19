'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@drive247/ui';
import { rentalsApi } from '@/lib/api';
import type { RentalListItem } from '@drive247/shared-types';

const STATUS_ALL = 'all';

const statusColor: Record<string, string> = {
  pending: 'text-[#d97706]',
  active: 'text-[#16a34a]',
  completed: 'text-[#2563eb]',
  cancelled: 'text-[#dc2626]',
};

export default function RentalsPage() {
  const [items, setItems] = useState<RentalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(STATUS_ALL);

  const fetchRentals = async () => {
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (status !== STATUS_ALL) params.status = status;
      const { data: res } = await rentalsApi.list(params as never);
      if (res.success) setItems(res.data.items);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load rentals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(fetchRentals, 250);
    return () => clearTimeout(t);
  }, [search, status]);

  const formatMoney = (value: string) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'GBP',
    }).format(Number(value));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[30px] font-medium text-[#080812]">Rentals</h2>
        <Button asChild>
          <Link href="/rentals/new">New Rental</Link>
        </Button>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search by customer name or vehicle reg"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm bg-white"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Customer</TableHead>
                <TableHead className="text-[#6366f1]">Vehicle</TableHead>
                <TableHead className="text-[#6366f1]">Start</TableHead>
                <TableHead className="text-[#6366f1]">End</TableHead>
                <TableHead className="text-[#6366f1]">Period</TableHead>
                <TableHead className="text-[#6366f1] text-right">Total</TableHead>
                <TableHead className="text-[#6366f1]">Status</TableHead>
                <TableHead className="text-[#6366f1] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">Loading...</span>
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">No rentals found</span>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customer.name}</TableCell>
                    <TableCell>
                      {r.vehicle.reg}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({r.vehicle.make} {r.vehicle.model})
                      </span>
                    </TableCell>
                    <TableCell>{r.startDate}</TableCell>
                    <TableCell>{r.endDate}</TableCell>
                    <TableCell className="capitalize">{r.periodType}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.totalAmount)}</TableCell>
                    <TableCell>
                      <span className={`text-sm font-medium capitalize ${statusColor[r.status] ?? ''}`}>
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/rentals/${r.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
