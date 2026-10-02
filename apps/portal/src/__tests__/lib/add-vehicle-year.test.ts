/**
 * A model year is allowed to be ahead of the year the car was bought.
 *
 * The form used to reject `year > acquisitionYear` outright, which is wrong
 * about how cars are sold: manufacturers release the next model year from
 * roughly the middle of the preceding year. An operator could not add a 2025
 * Civic acquired in 2024 — a real vehicle in their fleet, refused at the form.
 *
 * The rule still has a job. It is there to catch a mistyped year, so these pin
 * both edges: one year of lead is accepted, two is not, and the old 2025-in-2024
 * case is explicitly covered so it cannot quietly come back.
 *
 * The same schema backs both the v1 and v2 Add Vehicle dialogs, so this is the
 * only place the rule is stated.
 */

import { describe, expect, it } from 'vitest';
import { addVehicleDialogSchema } from '@/client-schemas/vehicles/add-vehicle-dialog';

/** A complete, valid vehicle; each test varies only the two fields it is about. */
const vehicle = (year: number, acquired: string) => ({
  reg: 'AB12 CDE',
  make: 'Honda',
  model: 'Civic',
  year,
  colour: 'Sonic Gray',
  fuel_type: 'Petrol' as const,
  daily_rent: 60,
  weekly_rent: 350,
  monthly_rent: 1200,
  acquisition_date: new Date(acquired),
  acquisition_type: 'Purchase' as const,
  purchase_price: 24000,
});

/** The `year` issues only, so an unrelated failure cannot read as a pass. */
const yearErrors = (input: ReturnType<typeof vehicle>) => {
  const result = addVehicleDialogSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.path[0] === 'year').map((i) => i.message);
};

describe('a model year ahead of the acquisition year', () => {
  it('accepts the case that was reported: a 2025 bought in 2024', () => {
    expect(yearErrors(vehicle(2025, '2024-11-20'))).toEqual([]);
  });

  it('accepts a model year equal to the acquisition year', () => {
    expect(yearErrors(vehicle(2024, '2024-06-01'))).toEqual([]);
  });

  it('accepts a car bought the year after its model year', () => {
    // Unsold stock, or a used car. Never the thing being guarded against.
    expect(yearErrors(vehicle(2023, '2025-02-10'))).toEqual([]);
  });
});

/*
 * These stay relative to today on purpose. The `year` field itself is capped at
 * `currentYear + 1`, so a fixed far-future year (2030) is caught by THAT rule
 * and never reaches this one — the first draft of this file asserted against a
 * message it was not actually testing. The widest gap that still gets past the
 * field cap is `currentYear + 1` against an old acquisition date.
 */
const THIS_YEAR = new Date().getFullYear();

describe('but the rule still catches a mistyped year', () => {
  it('rejects two years of lead, which no manufacturer offers', () => {
    const errors = yearErrors(vehicle(THIS_YEAR + 1, `${THIS_YEAR - 2}-11-20`));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/more than one year ahead/);
  });

  it('names both numbers, so the operator can see which one is wrong', () => {
    const [message] = yearErrors(vehicle(THIS_YEAR + 1, `${THIS_YEAR - 3}-01-01`));
    expect(message).toContain(String(THIS_YEAR + 1));
    expect(message).toContain(String(THIS_YEAR - 3));
  });
});
