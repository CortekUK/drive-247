"use client";

import { useState } from "react";
import { RentalPicker, type PickerRental } from "@/components/shared/rental-picker";
import { BuyInsuranceDialog } from "@/components/rentals/buy-insurance-dialog";

interface GenerateInsuranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchaseComplete?: (premium: number) => void;
}

export function GenerateInsuranceDialog({
  open,
  onOpenChange,
  onPurchaseComplete,
}: GenerateInsuranceDialogProps) {
  const [selectedRental, setSelectedRental] = useState<PickerRental | null>(null);

  const handleSelect = (rental: PickerRental) => {
    setSelectedRental(rental);
    onOpenChange(false);
  };

  const handleBuyComplete = (premium: number) => {
    onPurchaseComplete?.(premium);
    setSelectedRental(null);
  };

  const handleBuyOpenChange = (next: boolean) => {
    if (!next) setSelectedRental(null);
  };

  return (
    <>
      <RentalPicker
        open={open}
        onOpenChange={onOpenChange}
        mode="insurance"
        onSelect={handleSelect}
        title="Generate Bonzah Insurance"
        description="Pick a rental to issue insurance for. The standard coverage and payment flow will follow."
      />

      {selectedRental && (
        <BuyInsuranceDialog
          open={!!selectedRental}
          onOpenChange={handleBuyOpenChange}
          rental={{
            id: selectedRental.id,
            start_date: selectedRental.start_date,
            end_date: selectedRental.end_date,
            customer_id: selectedRental.customer_id,
            customers: {
              id: selectedRental.customers.id,
              name: selectedRental.customers.name,
              email: selectedRental.customers.email || undefined,
              phone: selectedRental.customers.phone,
            },
            vehicles: selectedRental.vehicles,
          }}
          onPurchaseComplete={handleBuyComplete}
        />
      )}
    </>
  );
}
