'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@drive247/ui';
import type {
  CustomerResponse,
  RentalPeriodType,
  VehicleResponse,
} from '@drive247/shared-types';
import { CustomerPicker } from './customer-picker';
import { VehiclePicker } from './vehicle-picker';

export interface RentalFormValue {
  customer: CustomerResponse | null;
  vehicle: VehicleResponse | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  periodType: RentalPeriodType;
  totalAmount: string; // keep as string for input
}

export function blankRentalForm(): RentalFormValue {
  return {
    customer: null,
    vehicle: null,
    startDate: '',
    endDate: '',
    periodType: 'daily' as RentalPeriodType,
    totalAmount: '',
  };
}

interface Props {
  value: RentalFormValue;
  onChange: (value: RentalFormValue) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  secondary?: { label: string; onClick: () => void };
  excludeRentalId?: string;
  lockCustomerAndVehicle?: boolean;
}

export function RentalForm({
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  secondary,
  excludeRentalId,
  lockCustomerAndVehicle = false,
}: Props) {
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!lockCustomerAndVehicle && !value.customer) {
      setError('Please select a customer');
      return;
    }
    if (!lockCustomerAndVehicle && !value.vehicle) {
      setError('Please select a vehicle');
      return;
    }
    if (!value.startDate || !value.endDate) {
      setError('Please pick start and end dates');
      return;
    }
    if (value.endDate < value.startDate) {
      setError('End date must be on or after start date');
      return;
    }
    const amount = Number(value.totalAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid total amount');
      return;
    }

    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-5 p-6">
          {!lockCustomerAndVehicle && (
            <>
              <CustomerPicker
                value={value.customer}
                onChange={(customer) => onChange({ ...value, customer })}
              />
              <VehiclePicker
                value={value.vehicle}
                onChange={(vehicle) => onChange({ ...value, vehicle })}
                startDate={value.startDate || undefined}
                endDate={value.endDate || undefined}
                excludeRentalId={excludeRentalId}
              />
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                value={value.startDate}
                onChange={(e) =>
                  onChange({ ...value, startDate: e.target.value })
                }
                required
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End date</Label>
              <Input
                id="endDate"
                type="date"
                value={value.endDate}
                onChange={(e) =>
                  onChange({ ...value, endDate: e.target.value })
                }
                required
                min={value.startDate || undefined}
                className="bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Period type</Label>
              <Select
                value={value.periodType}
                onValueChange={(v) =>
                  onChange({ ...value, periodType: v as RentalPeriodType })
                }
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="total">Total amount</Label>
              <Input
                id="total"
                type="number"
                step="0.01"
                min={0}
                value={value.totalAmount}
                onChange={(e) =>
                  onChange({ ...value, totalAmount: e.target.value })
                }
                required
                className="bg-white"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-[#dc2626]">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            {secondary && (
              <Button
                type="button"
                variant="outline"
                onClick={secondary.onClick}
              >
                {secondary.label}
              </Button>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : submitLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
