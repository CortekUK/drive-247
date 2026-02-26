import { z } from "zod";

export const customerFormModalSchema = z.object({
  customer_type: z.enum(['Individual', 'Company']),
  name: z.string()
    .min(1, "Name is required")
    .refine((val) => !/\d/.test(val), "Name cannot contain numbers"),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string()
    .optional()
    .refine((val) => !val || /^[0-9\s\-\(\)\+]+$/.test(val), "Phone number can only contain numbers and formatting characters"),
  date_of_birth: z.string().optional(),
  license_number: z.string().optional(),
  id_number: z.string().optional(),
  is_gig_driver: z.boolean(),
  whatsapp_opt_in: z.boolean(),
  status: z.enum(['Active', 'Inactive']),
  notes: z.string().optional(),
  nok_full_name: z.string()
    .optional()
    .refine((val) => !val || !/\d/.test(val), "Name cannot contain numbers"),
  nok_relationship: z.string()
    .optional()
    .refine((val) => !val || /^[a-zA-Z\s]+$/.test(val), "Relationship can only contain letters"),
  nok_phone: z.string()
    .optional()
    .refine((val) => !val || /^[0-9\s\-\(\)\+]+$/.test(val), "Phone number can only contain numbers and formatting characters"),
  nok_email: z.string().email("Invalid email format").optional().or(z.literal("")),
  nok_address: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.email && !data.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either email or phone is required",
      path: ["email"],
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either email or phone is required",
      path: ["phone"],
    });
  }
});

export type CustomerFormModalFormValues = z.infer<typeof customerFormModalSchema>;
