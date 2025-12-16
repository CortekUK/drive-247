import { z } from "zod";

export const addFineDialogSchema = z.object({
  type: z.enum(["PCN", "Speeding", "Other"]),
  vehicle_id: z.string().min(1, "Vehicle is required"),
  customer_id: z.string().min(1, "Customer is required"),
  reference_no: z.string().optional(),
  issue_date: z.date({
    required_error: "Issue date is required",
  }),
  due_date: z.date({
    required_error: "Due date is required",
  }),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number",
  }),
  liability: z.enum(["Customer", "Company"]).default("Customer"),
  notes: z.string().optional(),
});

export type AddFineDialogFormValues = z.infer<typeof addFineDialogSchema>;
