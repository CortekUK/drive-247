import { z } from "zod";

export const contactCardEditorSchema = z.object({
  title: z.string().min(1, "Card title is required"),
  description: z.string().optional(),
  phone_number: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  call_button_text: z.string().optional(),
  email_button_text: z.string().optional(),
});

export type ContactCardEditorFormValues = z.infer<typeof contactCardEditorSchema>;
