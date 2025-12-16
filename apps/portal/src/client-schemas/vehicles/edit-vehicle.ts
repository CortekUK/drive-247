import { z } from "zod";

export const editVehicleSchema = z.object({
  reg: z.string().min(1, "Registration number is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.number({ required_error: "Year is required", invalid_type_error: "Year must be a number" }).min(1900, "Year must be after 1900").max(new Date().getFullYear() + 1, "Year cannot be in the future"),
  colour: z.string().min(1, "Color is required"),
  purchase_price: z.number().min(0, "Price must be positive").optional(),
  contract_total: z.number().min(0, "Contract total must be positive").optional(),
  daily_rent: z.number({ required_error: "Daily rent is required", invalid_type_error: "Daily rent must be a number" }).min(0, "Daily rent must be positive"),
  weekly_rent: z.number({ required_error: "Weekly rent is required", invalid_type_error: "Weekly rent must be a number" }).min(0, "Weekly rent must be positive"),
  monthly_rent: z.number({ required_error: "Monthly rent is required", invalid_type_error: "Monthly rent must be a number" }).min(0, "Monthly rent must be positive"),
  acquisition_date: z.date(),
  acquisition_type: z.enum(['Purchase', 'Finance']),
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
}).refine(
  (data) => {
    if (data.acquisition_type === 'Finance' && !data.contract_total) {
      return false;
    }
    if (data.acquisition_type === 'Purchase' && !data.purchase_price) {
      return false;
    }
    return true;
  },
  {
    message: "Contract total is required for financed vehicles",
    path: ["contract_total"],
  }
).refine((data) => {
  if (data.has_spare_key) {
    return data.spare_key_holder !== undefined;
  }
  return true;
}, {
  message: "Spare key holder is required when spare key exists",
  path: ["spare_key_holder"],
});

export type EditVehicleFormValues = z.infer<typeof editVehicleSchema>;
