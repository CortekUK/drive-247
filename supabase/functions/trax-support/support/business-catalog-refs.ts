/**
 * Reference fields shared by every dataset that points at a customer, a car or a
 * rental.
 *
 * They live in their own module because `business-catalog.ts` imports the module
 * datasets and the module datasets need these: declaring them in either file makes
 * a runtime cycle, and the side that evaluates first sees `undefined` where a field
 * should be. Only the TYPE is imported here, and a type import is erased, so
 * nothing circular survives to runtime.
 *
 * `labels` is what turns a stored id into the name a person uses. Grouping by
 * customer used to answer with "9927be94-078c-…", because a group's label was the
 * raw column value; the lookup is tenant-scoped and reads only the columns named
 * here, so it can name a record without widening what the caller may see.
 */
import type { Field } from './business-catalog.ts';

export const CUSTOMER_REF: Field = {
  name: 'customer_id', column: 'customer_id', kind: 'uuid', label: 'Customer', groupable: true, filterable: true,
  labels: { table: 'customers', keyColumn: 'id', tenantColumn: 'tenant_id', columns: ['name'] },
};

export const VEHICLE_REF: Field = {
  name: 'vehicle_id', column: 'vehicle_id', kind: 'uuid', label: 'Vehicle', groupable: true, filterable: true,
  // Plate first: it is what staff say out loud. Make and model disambiguate a fleet
  // with repeated plates in test data.
  labels: { table: 'vehicles', keyColumn: 'id', tenantColumn: 'tenant_id', columns: ['reg', 'make', 'model'] },
};

export const RENTAL_REF: Field = {
  name: 'rental_id', column: 'rental_id', kind: 'uuid', label: 'Rental', groupable: true, filterable: true,
  labels: { table: 'rentals', keyColumn: 'id', tenantColumn: 'tenant_id', columns: ['rental_number'] },
};
