import { z } from "zod";

export const contactFormEditorSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  subtitle: z.string().min(1, "Subtitle is required").max(200),
  success_message: z.string().min(1, "Success message is required").max(500),
  gdpr_text: z.string().min(1, "GDPR text is required").max(300),
  submit_button_text: z.string().min(1, "Button text is required").max(50),
  subject_options: z.array(z.string().min(1)).min(1, "At least one subject option is required"),
});

export type ContactFormEditorFormValues = z.infer<typeof contactFormEditorSchema>;
