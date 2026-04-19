import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { bonzahInsurancePolicies } from '../schema';

export const insertBonzahInsurancePolicySchema = createInsertSchema(
  bonzahInsurancePolicies,
);
export const selectBonzahInsurancePolicySchema = createSelectSchema(
  bonzahInsurancePolicies,
);
