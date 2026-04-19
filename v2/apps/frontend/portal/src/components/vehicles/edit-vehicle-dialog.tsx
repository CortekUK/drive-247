'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@drive247/ui';
import { vehiclesApi } from '@/lib/api';
import type { VehicleResponse } from '@drive247/shared-types';

interface Props {
  vehicle: VehicleResponse;
  onClose: () => void;
  onUpdated: () => void;
}

export function EditVehicleDialog({ vehicle, onClose, onUpdated }: Props) {
  const currentYear = new Date().getFullYear();
  const [reg, setReg] = useState(vehicle.reg);
  const [make, setMake] = useState(vehicle.make);
  const [model, setModel] = useState(vehicle.model);
  const [year, setYear] = useState(vehicle.year);
  const [dailyRent, setDailyRent] = useState(vehicle.dailyRent);
  const [weeklyRent, setWeeklyRent] = useState(vehicle.weeklyRent);
  const [monthlyRent, setMonthlyRent] = useState(vehicle.monthlyRent);
  const [status, setStatus] = useState<'active' | 'inactive'>(vehicle.status);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await vehiclesApi.update(vehicle.id, {
        reg: reg.trim(),
        make: make.trim(),
        model: model.trim(),
        year,
        dailyRent: Number(dailyRent),
        weeklyRent: Number(weeklyRent),
        monthlyRent: Number(monthlyRent),
        status,
      } as never);
      toast.success('Vehicle updated');
      onUpdated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>Edit Vehicle</DialogTitle>
        <DialogDescription>Update the vehicle details.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reg">Registration</Label>
            <Input
              id="reg"
              value={reg}
              onChange={(e) => setReg(e.target.value.toUpperCase())}
              required
              maxLength={20}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="make">Make</Label>
              <Input
                id="make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Input
              id="year"
              type="number"
              min={1900}
              max={currentYear + 1}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="daily">Daily rate</Label>
              <Input
                id="daily"
                type="number"
                step="0.01"
                min={0}
                value={dailyRent}
                onChange={(e) => setDailyRent(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weekly">Weekly rate</Label>
              <Input
                id="weekly"
                type="number"
                step="0.01"
                min={0}
                value={weeklyRent}
                onChange={(e) => setWeeklyRent(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly">Monthly rate</Label>
              <Input
                id="monthly"
                type="number"
                step="0.01"
                min={0}
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as 'active' | 'inactive')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
