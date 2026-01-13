import { z } from "zod";

export const addUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  role: z.enum(['admin', 'ops', 'viewer'], {
    required_error: "Role is required"
  }),
});

export type AddUserFormValues = z.infer<typeof addUserSchema>;
