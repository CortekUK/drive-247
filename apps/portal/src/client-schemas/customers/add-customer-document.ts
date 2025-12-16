import { z } from "zod";

const DOCUMENT_TYPES = [
  'Insurance Certificate',
  "Driver's License",
  'Social Security',
  'Address Proof',
  'ID Card/Passport',
  'Other'
] as const;

export const addCustomerDocumentSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES, { required_error: "Document type is required" }),
  document_name: z.string().min(1, "Document name is required"),
  vehicle_id: z.string().optional(),
  insurance_provider: z.string().optional(),
  policy_number: z.string().optional(),
  start_date: z.date().optional(),
  end_date: z.date().optional(),
  notes: z.string().optional(),
});

export type AddCustomerDocumentFormValues = z.infer<typeof addCustomerDocumentSchema>;
