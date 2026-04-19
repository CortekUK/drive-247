'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogTrigger,
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
import { vehiclesApi } from '@/lib/api';
import type {
  VehicleResponse,
  VehicleStatus,
} from '@drive247/shared-types';
import { AddVehicleDialog } from '@/components/vehicles/add-vehicle-dialog';

const STATUS_ALL = 'all';

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(STATUS_ALL);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchVehicles = async () => {
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (status !== STATUS_ALL) params.status = status;
      const { data: res } = await vehiclesApi.list(params as never);
      if (res.success) setVehicles(res.data.items);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(fetchVehicles, 250);
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
        <h2 className="text-[30px] font-medium text-[#080812]">Vehicles</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Add Vehicle</Button>
          </DialogTrigger>
          <AddVehicleDialog
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false);
              fetchVehicles();
            }}
          />
        </Dialog>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search by reg, make, or model"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm bg-white"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Reg</TableHead>
                <TableHead className="text-[#6366f1]">Make / Model</TableHead>
                <TableHead className="text-[#6366f1]">Year</TableHead>
                <TableHead className="text-[#6366f1] text-right">Daily</TableHead>
                <TableHead className="text-[#6366f1] text-right">Weekly</TableHead>
                <TableHead className="text-[#6366f1] text-right">Monthly</TableHead>
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
              ) : vehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">No vehicles found</span>
                  </TableCell>
                </TableRow>
              ) : (
                vehicles.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.reg}</TableCell>
                    <TableCell>
                      {v.make} {v.model}
                    </TableCell>
                    <TableCell>{v.year}</TableCell>
                    <TableCell className="text-right">{formatMoney(v.dailyRent)}</TableCell>
                    <TableCell className="text-right">{formatMoney(v.weeklyRent)}</TableCell>
                    <TableCell className="text-right">{formatMoney(v.monthlyRent)}</TableCell>
                    <TableCell>
                      {v.status === 'active' ? (
                        <span className="text-[#16a34a] text-sm font-medium">Active</span>
                      ) : (
                        <span className="text-[#dc2626] text-sm font-medium">Inactive</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/vehicles/${v.id}`}>View</Link>
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
