'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, Check, Package, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/format-utils';
import type { RentalExtra } from '@/hooks/use-rental-extras';

interface ExtrasSelectorProps {
  extras: RentalExtra[];
  selectedExtras: Record<string, number>;
  onExtrasChange: (extras: Record<string, number>) => void;
  isLoading: boolean;
  currencyCode: string;
}

export default function ExtrasSelector({
  extras,
  selectedExtras,
  onExtrasChange,
  isLoading,
  currencyCode,
}: ExtrasSelectorProps) {
  const toggleExtra = (extraId: string) => {
    const newExtras = { ...selectedExtras };
    if (newExtras[extraId]) {
      delete newExtras[extraId];
    } else {
      newExtras[extraId] = 1;
    }
    onExtrasChange(newExtras);
  };

  const updateQuantity = (extraId: string, delta: number) => {
    const current = selectedExtras[extraId] || 0;
    const newQty = current + delta;
    const newExtras = { ...selectedExtras };
    if (newQty <= 0) {
      delete newExtras[extraId];
    } else {
      newExtras[extraId] = newQty;
    }
    onExtrasChange(newExtras);
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (extras.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 sm:p-6">
      <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
        <Package className="h-5 w-5" />
        Optional Extras
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {extras.map((extra) => {
          const isSelected = !!selectedExtras[extra.id];
          const quantity = selectedExtras[extra.id] || 0;
          const isQuantityBased = extra.max_quantity !== null;
          const maxAvailable = extra.remaining_stock ?? extra.max_quantity ?? 99;

          return (
            <div
              key={extra.id}
              className={`relative rounded-lg border p-3 transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'hover:border-primary/30'
              }`}
            >
              <div className="flex gap-3">
                {extra.image_urls.length > 0 && (
                  <img
                    src={extra.image_urls[0]}
                    alt={extra.name}
                    className="w-16 h-16 rounded-md object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{extra.name}</p>
                      {extra.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {extra.description}
                        </p>
                      )}
                    </div>
                    <p className="font-semibold text-sm whitespace-nowrap">
                      {formatCurrency(extra.price, currencyCode)}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    {isQuantityBased && maxAvailable <= 3 && maxAvailable > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {maxAvailable} left
                      </Badge>
                    )}
                    {isQuantityBased && maxAvailable === 0 && (
                      <Badge variant="destructive" className="text-[10px]">Out of stock</Badge>
                    )}
                    {!isQuantityBased && !isSelected && <span />}
                    {isQuantityBased && maxAvailable > 0 && <span />}

                    {/* Toggle button for non-quantity extras */}
                    {!isQuantityBased && (
                      <Button
                        type="button"
                        variant={isSelected ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => toggleExtra(extra.id)}
                      >
                        {isSelected ? (
                          <>
                            <Check className="h-3 w-3 mr-1" />
                            Added
                          </>
                        ) : (
                          'Add'
                        )}
                      </Button>
                    )}

                    {/* Quantity stepper for quantity-based extras */}
                    {isQuantityBased && maxAvailable > 0 && (
                      <div className="flex items-center gap-1">
                        {quantity > 0 ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(extra.id, -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm font-medium">{quantity}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(extra.id, 1)}
                              disabled={quantity >= maxAvailable}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateQuantity(extra.id, 1)}
                          >
                            Add
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
