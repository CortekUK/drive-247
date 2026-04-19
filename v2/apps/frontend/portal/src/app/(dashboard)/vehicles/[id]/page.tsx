'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogTrigger,
  Separator,
} from '@drive247/ui';
import { vehiclesApi } from '@/lib/api';
import type { VehicleResponse } from '@drive247/shared-types';
import { EditVehicleDialog } from '@/components/vehicles/edit-vehicle-dialog';

export default function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [vehicle, setVehicle] = useState<VehicleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchVehicle = async () => {
    try {
      const { data: res } = await vehiclesApi.getById(id);
      if (res.success) setVehicle(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load vehicle');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDelete = async () => {
    if (!confirm('Delete this vehicle? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await vehiclesApi.remove(id);
      toast.success('Vehicle deleted');
      router.push('/vehicles');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete vehicle');
      setDeleting(false);
    }
  };

  const formatMoney = (value: string) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'GBP',
    }).format(Number(value));

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!vehicle) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Vehicle not found.</p>
        <Button variant="outline" asChild>
          <Link href="/vehicles">Back to vehicles</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/vehicles"
            className="text-sm text-[#6366f1] hover:underline"
          >
            ← Vehicles
          </Link>
          <h2 className="text-[30px] font-medium text-[#080812] mt-1">
            {vehicle.reg}
          </h2>
          <p className="text-sm text-muted-foreground">
            {vehicle.make} {vehicle.model} · {vehicle.year}
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit</Button>
            </DialogTrigger>
            <EditVehicleDialog
              vehicle={vehicle}
              onClose={() => setEditOpen(false)}
              onUpdated={() => {
                setEditOpen(false);
                fetchVehicle();
              }}
            />
          </Dialog>
          <Button
            variant="outline"
            className="text-[#dc2626]"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Registration" value={vehicle.reg} />
            <Row label="Make" value={vehicle.make} />
            <Row label="Model" value={vehicle.model} />
            <Row label="Year" value={String(vehicle.year)} />
            <Row
              label="Status"
              value={
                vehicle.status === 'active' ? (
                  <span className="text-[#16a34a] font-medium">Active</span>
                ) : (
                  <span className="text-[#dc2626] font-medium">Inactive</span>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Daily rate" value={formatMoney(vehicle.dailyRent)} />
            <Row label="Weekly rate" value={formatMoney(vehicle.weeklyRent)} />
            <Row label="Monthly rate" value={formatMoney(vehicle.monthlyRent)} />
            <Separator />
            <Row
              label="Created"
              value={new Date(vehicle.createdAt).toLocaleDateString()}
            />
            <Row
              label="Updated"
              value={new Date(vehicle.updatedAt).toLocaleDateString()}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
