import { describe, expect, it } from "vitest";
import { priceCatalogueForCar, type CatalogueExtraRow } from "@/components/rentals-v2/rental-detail/extras-catalogue-price";

// QA P3 (Extras): the booking Extras screen priced a per-car extra at
// rental_extras.price, a 0 placeholder for per-car extras, so a $24.99 Beach
// kit showed and saved as $0.00.
const KIA = "car-kia";
const CAMRY = "car-camry";

const row = (over: Partial<CatalogueExtraRow>): CatalogueExtraRow => ({
  id: "x",
  name: "Extra",
  description: null,
  price: 0,
  pricing_type: "global",
  billing_type: "per_trip",
  max_quantity: null,
  image_urls: null,
  rental_extras_vehicle_pricing: [],
  ...over,
});

const catalogue: CatalogueExtraRow[] = [
  row({ id: "cooler", name: "Cooler", price: 7.35, billing_type: "per_day" }),
  row({ id: "beach", name: "Beach kit", pricing_type: "per_vehicle", rental_extras_vehicle_pricing: [{ vehicle_id: KIA, price: 24.99 }] }),
];

describe("priceCatalogueForCar", () => {
  it("prices a per-car extra at its price for the rental's car, not the 0 placeholder", () => {
    const out = priceCatalogueForCar(catalogue, KIA);
    expect(out.map((e) => [e.id, e.price])).toEqual([
      ["cooler", 7.35],
      ["beach", 24.99],
    ]);
  });

  it("does not offer a per-car extra on a car with no price for it", () => {
    expect(priceCatalogueForCar(catalogue, CAMRY).map((e) => e.id)).toEqual(["cooler"]);
  });

  it("offers only every-car extras when the rental has no car", () => {
    expect(priceCatalogueForCar(catalogue, null).map((e) => e.id)).toEqual(["cooler"]);
  });

  it("returns plain catalogue rows without the pricing columns", () => {
    const [cooler] = priceCatalogueForCar(catalogue, KIA);
    expect(cooler).not.toHaveProperty("pricing_type");
    expect(cooler).not.toHaveProperty("rental_extras_vehicle_pricing");
  });
});
