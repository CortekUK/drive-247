import { z } from "zod";

export const permissionEntrySchema = z.object({
  tab_key: z.string(),
  access_level: z.enum(['viewer', 'editor']),
});

export const addUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  role: z.enum(['admin', 'manager', 'ops', 'viewer'], {
    required_error: "Role is required"
  }),
  permissions: z.array(permissionEntrySchema).optional(),
}).refine(
  (data) => {
    if (data.role === 'manager') {
      return data.permissions && data.permissions.length > 0;
    }
    return true;
  },
  {
    message: "Manager role requires at least one tab permission",
    path: ["permissions"],
  }
);

export type AddUserFormValues = z.infer<typeof addUserSchema>;
export type PermissionEntry = z.infer<typeof permissionEntrySchema>;
