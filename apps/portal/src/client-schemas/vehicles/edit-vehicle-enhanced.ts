import { z } from "zod";

export const editVehicleEnhancedSchema = z.object({
  reg: z.string().min(1, "Registration number is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  colour: z.string().min(1, "Colour is required"),
  fuel_type: z.enum(['Petrol', 'Diesel', 'Hybrid', 'Electric']),
  purchase_price: z.union([z.number().min(0, "Price must be positive"), z.undefined(), z.null()]).optional(),
  contract_total: z.union([z.number().min(0, "Contract total must be positive"), z.undefined(), z.null()]).optional(),
  acquisition_date: z.date(),
  acquisition_type: z.enum(['Purchase', 'Finance']),
  // Rent fields
  daily_rent: z.number({ required_error: "Daily rent is required", invalid_type_error: "Daily rent must be a number" }).min(0, "Daily rent must be positive"),
  weekly_rent: z.number({ required_error: "Weekly rent is required", invalid_type_error: "Weekly rent must be a number" }).min(0, "Weekly rent must be positive"),
  monthly_rent: z.number({ required_error: "Monthly rent is required", invalid_type_error: "Monthly rent must be a number" }).min(0, "Monthly rent must be positive"),
  // Security deposit
  security_deposit: z.union([z.number().min(0, "Security deposit must be positive"), z.undefined(), z.null()]).optional(),
  // Allowed mileage per month (miles)
  allowed_mileage: z.union([z.number().int().min(1, "Mileage must be at least 1 mile"), z.undefined(), z.null()]).optional(),
  // MOT & TAX fields
  mot_due_date: z.date().optional(),
  tax_due_date: z.date().optional(),
  // Warranty fields
  warranty_start_date: z.date().optional(),
  warranty_end_date: z.date().optional(),
  // Logbook field
  has_logbook: z.boolean().default(false),
  // Service plan and spare key fields
  has_service_plan: z.boolean().default(false),
  has_spare_key: z.boolean().default(false),
  spare_key_holder: z.enum(["Company", "Customer"]).optional(),
  spare_key_notes: z.string().optional(),
  // Security fields
  has_tracker: z.boolean().default(false),
  has_remote_immobiliser: z.boolean().default(false),
  security_notes: z.string().optional(),
  // Description
  description: z.string().optional(),
}).superRefine((data, ctx) => {
  // Check purchase price for Purchase type
  if (data.acquisition_type === 'Purchase' && (data.purchase_price === undefined || data.purchase_price === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Purchase price is required for purchased vehicles",
      path: ["purchase_price"],
    });
  }

  // Check contract total for Finance type
  if (data.acquisition_type === 'Finance' && (data.contract_total === undefined || data.contract_total === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Contract total is required for financed vehicles",
      path: ["contract_total"],
    });
  }
}).refine((data) => {
  if (data.has_spare_key) {
    return data.spare_key_holder !== undefined;
  }
  return true;
}, {
  message: "Spare key holder is required when spare key exists",
  path: ["spare_key_holder"],
});

export type EditVehicleEnhancedFormValues = z.infer<typeof editVehicleEnhancedSchema>;
