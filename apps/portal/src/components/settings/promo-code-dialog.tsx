'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { usePromoCodes, PromoCode } from '@/hooks/use-promo-codes';

const promoCodeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  promo_code: z
    .string()
    .min(3, 'Code must be at least 3 characters')
    .max(20, 'Code must be at most 20 characters')
    .regex(/^[A-Z0-9_-]+$/i, 'Code can only contain letters, numbers, hyphens, and underscores'),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().min(0.01, 'Discount must be greater than 0'),
  minimum_spend: z.number().min(0).optional(),
  start_date: z.date({ required_error: 'Start date is required' }),
  end_date: z.date({ required_error: 'End date is required' }),
  is_active: z.boolean(),
}).refine((data) => data.end_date >= data.start_date, {
  message: 'End date must be after start date',
  path: ['end_date'],
}).refine((data) => {
  if (data.discount_type === 'percentage' && data.discount_value > 100) {
    return false;
  }
  return true;
}, {
  message: 'Percentage discount cannot exceed 100%',
  path: ['discount_value'],
});

type PromoCodeFormData = z.infer<typeof promoCodeSchema>;

interface PromoCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promoCode: PromoCode | null;
}

export const PromoCodeDialog = ({ open, onOpenChange, promoCode }: PromoCodeDialogProps) => {
  const { createPromoCode, updatePromoCode } = usePromoCodes();
  const isEditing = !!promoCode;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<PromoCodeFormData>({
    resolver: zodResolver(promoCodeSchema),
    defaultValues: {
      title: '',
      description: '',
      promo_code: '',
      discount_type: 'percentage',
      discount_value: 10,
      minimum_spend: 0,
      start_date: new Date(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      is_active: true,
    },
  });

  const discountType = watch('discount_type');
  const startDate = watch('start_date');
  const endDate = watch('end_date');
  const isActive = watch('is_active');

  useEffect(() => {
    if (open) {
      if (promoCode) {
        reset({
          title: promoCode.title,
          description: promoCode.description,
          promo_code: promoCode.promo_code || '',
          discount_type: promoCode.discount_type as 'percentage' | 'fixed',
          discount_value: promoCode.discount_value,
          minimum_spend: promoCode.minimum_spend || 0,
          start_date: new Date(promoCode.start_date),
          end_date: new Date(promoCode.end_date),
          is_active: promoCode.is_active ?? true,
        });
      } else {
        reset({
          title: '',
          description: '',
          promo_code: '',
          discount_type: 'percentage',
          discount_value: 10,
          minimum_spend: 0,
          start_date: new Date(),
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          is_active: true,
        });
      }
    }
  }, [open, promoCode, reset]);

  const onSubmit = async (data: PromoCodeFormData) => {
    const formattedData = {
      title: data.title,
      description: data.description,
      promo_code: data.promo_code.toUpperCase(),
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      minimum_spend: data.minimum_spend || 0,
      start_date: format(data.start_date, 'yyyy-MM-dd'),
      end_date: format(data.end_date, 'yyyy-MM-dd'),
      is_active: data.is_active,
    };

    try {
      if (isEditing && promoCode) {
        await updatePromoCode.mutateAsync({ id: promoCode.id, ...formattedData });
      } else {
        await createPromoCode.mutateAsync(formattedData);
      }
      onOpenChange(false);
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const isPending = createPromoCode.isPending || updatePromoCode.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Promo Code' : 'Create Promo Code'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the promo code details below.'
              : 'Create a new promotional discount code for your customers.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          {/* Title & Promo Code */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Summer Sale"
                {...register('title')}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="promo_code">Code</Label>
              <Input
                id="promo_code"
                placeholder="SUMMER2024"
                className="uppercase"
                {...register('promo_code')}
              />
              {errors.promo_code && (
                <p className="text-xs text-destructive">{errors.promo_code.message}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Get 20% off your next rental"
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          {/* Discount Type and Value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Discount Type</Label>
              <Select
                value={discountType}
                onValueChange={(value: 'percentage' | 'fixed') =>
                  setValue('discount_type', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                  <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="discount_value">
                {discountType === 'percentage' ? 'Percentage' : 'Amount'}
              </Label>
              <div className="relative">
                <Input
                  id="discount_value"
                  type="number"
                  step={discountType === 'percentage' ? '1' : '0.01'}
                  min="0"
                  max={discountType === 'percentage' ? '100' : undefined}
                  className="pr-8"
                  {...register('discount_value', { valueAsNumber: true })}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {discountType === 'percentage' ? '%' : '$'}
                </span>
              </div>
              {errors.discount_value && (
                <p className="text-xs text-destructive">{errors.discount_value.message}</p>
              )}
            </div>
          </div>

          {/* Minimum Spend (only for fixed discounts) */}
          {discountType === 'fixed' && (
            <div className="space-y-1">
              <Label htmlFor="minimum_spend">Minimum Spend</Label>
              <div className="relative">
                <Input
                  id="minimum_spend"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g., 100"
                  className="pr-8"
                  {...register('minimum_spend', { valueAsNumber: true })}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Customer must spend at least this amount for the discount to apply
              </p>
            </div>
          )}

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !startDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'MMM dd, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setValue('start_date', date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              {errors.start_date && (
                <p className="text-xs text-destructive">{errors.start_date.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !endDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'MMM dd, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setValue('end_date', date)}
                    disabled={(date) => date < startDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              {errors.end_date && (
                <p className="text-xs text-destructive">{errors.end_date.message}</p>
              )}
            </div>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between py-2 px-3 border rounded-lg">
            <Label>Active</Label>
            <Switch
              checked={isActive}
              onCheckedChange={(checked) => setValue('is_active', checked)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
