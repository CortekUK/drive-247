import { z } from "zod";

export const contactInfoEditorSchema = z.object({
  phone: z.object({
    number: z.string().min(1, "Phone number is required"),
    availability: z.string().min(1, "Availability text is required"),
  }),
  email: z.object({
    address: z.string().email("Invalid email address"),
    response_time: z.string().min(1, "Response time text is required"),
  }),
  office: z.object({
    address: z.string().min(1, "Office address is required"),
  }),
  whatsapp: z.object({
    number: z.string().min(1, "WhatsApp number is required"),
    description: z.string().min(1, "WhatsApp description is required"),
  }),
});

export type ContactInfoEditorFormValues = z.infer<typeof contactInfoEditorSchema>;
