/** The tenant's own extras catalogue — what can be put on a rental. */
export type PricedCatalogueExtra = {
  id: string;
  name: string;
  description: string | null;
  /** Already resolved for this rental's car (see `useExtrasCatalogue`). */
  price: number;
  billing_type: "per_trip" | "per_day" | null;
  max_quantity: number | null;
  image_urls: string[] | null;
};

export type CatalogueExtraRow = Omit<PricedCatalogueExtra, "price"> & {
  price: number;
  pricing_type: "global" | "per_vehicle" | null;
  rental_extras_vehicle_pricing: { vehicle_id: string; price: number }[] | null;
};

/**
 * The catalogue priced for THIS rental's car, the way the booking site prices
 * it: a per-car extra costs its price for this car (its own `price` column is a
 * 0 placeholder), and a per-car extra with no price for this car is not
 * offered. `update_rental_extras_v2` resolves the price the same way on save.
 */
export function priceCatalogueForCar(rows: CatalogueExtraRow[], vehicleId: string | null): PricedCatalogueExtra[] {
  const out: PricedCatalogueExtra[] = [];
  for (const { pricing_type, rental_extras_vehicle_pricing, ...row } of rows) {
    if (pricing_type !== "per_vehicle") {
      out.push(row);
      continue;
    }
    const forCar = vehicleId ? (rental_extras_vehicle_pricing ?? []).find((vp) => vp.vehicle_id === vehicleId) : undefined;
    if (forCar) out.push({ ...row, price: Number(forCar.price) });
  }
  return out;
}
