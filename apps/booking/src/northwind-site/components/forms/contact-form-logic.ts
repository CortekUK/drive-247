import { z } from "zod";

/**
 * The contact form's rules — the vehicle choices, the validation, the empty
 * values and the submit — in one place, so the current form
 * (`contact-form.tsx`) and the v2 form (`site-v2/forms/contact-form.tsx`)
 * accept and send exactly the same thing. Only the markup differs.
 */

export const VEHICLE_OPTIONS = [
  { value: "lexus-rx", label: "Lexus RX" },
  { value: "porsche-911", label: "Porsche 911 Carrera" },
  { value: "aston-vanquish", label: "Aston Martin Vanquish" },
  { value: "rolls-phantom", label: "Rolls-Royce Phantom" },
  { value: "bmw-m4", label: "BMW M4" },
  { value: "audi-a4", label: "Audi A4" },
  { value: "other", label: "Other / Not sure" },
] as const;

export const contactSchema = z.object({
  fullName: z.string().min(1, "Required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(5, "Required"),
  vehicleOfInterest: z.string().min(1, "Required"),
  details: z.string().optional(),
});

export type ContactValues = z.infer<typeof contactSchema>;

export const CONTACT_DEFAULT_VALUES: ContactValues = {
  fullName: "",
  email: "",
  phone: "",
  vehicleOfInterest: "",
  details: "",
};

export async function submitContact(values: ContactValues): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  console.log("contact submission", values);
}
