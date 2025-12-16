import { z } from "zod";

const MAX_QUESTION = 200;
const MAX_ANSWER = 2000;

export const faqsManagerSchema = z.object({
  question: z.string().min(1, "Question is required").max(MAX_QUESTION, `Maximum ${MAX_QUESTION} characters`),
  answer: z.string().min(1, "Answer is required").max(MAX_ANSWER, `Maximum ${MAX_ANSWER} characters`),
  is_active: z.boolean(),
});

export type FAQsManagerFormValues = z.infer<typeof faqsManagerSchema>;
