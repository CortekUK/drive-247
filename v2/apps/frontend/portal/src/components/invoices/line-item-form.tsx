'use client';

import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@drive247/ui';
import { DiscountType } from '@drive247/shared-types';
import { parseToCents } from '@/lib/money';

export interface LineItemFormValues {
  description: string;
  quantity: number;
  unitPrice: number; // cents
  discountType: DiscountType | null;
  discountValue: number | null;
}

interface Props {
  initial?: Partial<LineItemFormValues>;
  onSubmit: (values: LineItemFormValues) => Promise<void> | void;
  onCancel: () => void;
  submitLabel: string;
}

const DISC_NONE = 'none';

export function LineItemForm({ initial, onSubmit, onCancel, submitLabel }: Props) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [quantity, setQuantity] = useState<number>(initial?.quantity ?? 1);
  const [unitPrice, setUnitPrice] = useState(
    initial?.unitPrice != null ? (initial.unitPrice / 100).toFixed(2) : '',
  );
  const [discountType, setDiscountType] = useState<string>(
    initial?.discountType ?? DISC_NONE,
  );
  const [discountValue, setDiscountValue] = useState(
    initial?.discountValue != null
      ? discountType === DiscountType.PERCENTAGE
        ? String(initial.discountValue)
        : (initial.discountValue / 100).toFixed(2)
      : '',
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const values: LineItemFormValues = {
        description: description.trim(),
        quantity,
        unitPrice: parseToCents(unitPrice),
        discountType:
          discountType === DISC_NONE ? null : (discountType as DiscountType),
        discountValue:
          discountType === DISC_NONE
            ? null
            : discountType === DiscountType.PERCENTAGE
              ? Number(discountValue)
              : parseToCents(discountValue),
      };
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          maxLength={200}
          className="bg-white"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            required
            className="bg-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unitPrice">Unit price</Label>
          <Input
            id="unitPrice"
            type="number"
            step="0.01"
            min={0}
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            required
            className="bg-white"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Discount</Label>
          <Select value={discountType} onValueChange={setDiscountType}>
            <SelectTrigger className="bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DISC_NONE}>None</SelectItem>
              <SelectItem value={DiscountType.PERCENTAGE}>Percentage</SelectItem>
              <SelectItem value={DiscountType.FIXED}>Fixed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="discountValue">
            Amount{discountType === DiscountType.PERCENTAGE ? ' (%)' : ''}
          </Label>
          <Input
            id="discountValue"
            type="number"
            step="0.01"
            min={0}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            disabled={discountType === DISC_NONE}
            className="bg-white"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
