import { z } from "zod";

import { supabase } from "@nw/integrations/supabase/client";

/**
 * The contact form's rules — the vehicle choices, the validation, the empty
 * values and the submit — in one place, so the current form
 * (`contact-form.tsx`) and the v2 form (`site-v2/forms/contact-form.tsx`)
 * accept and send exactly the same thing. Only the markup differs.
 */

export const VEHICLE_OPTIONS = [
  { value: "economy", label: "Economy" },
  { value: "sedan", label: "Sedan" },
  { value: "suv", label: "SUV" },
  { value: "truck", label: "Truck" },
  { value: "van", label: "Van" },
  { value: "luxury", label: "Luxury" },
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

/** The rental company the message goes to. */
export interface ContactRecipient {
  tenantId?: string | null;
  email?: string | null;
}

/**
 * Emails the message to the rental company, through the same function the
 * original booking site's contact page uses. Throws when it cannot be delivered,
 * so the form says so instead of claiming the message was sent.
 */
export async function submitContact(values: ContactValues, recipient: ContactRecipient): Promise<void> {
  if (!recipient.email) throw new Error("This company has no contact email");

  const vehicle =
    VEHICLE_OPTIONS.find((option) => option.value === values.vehicleOfInterest)?.label ?? values.vehicleOfInterest;

  const { error } = await supabase.functions.invoke("send-contact-email", {
    body: {
      name: values.fullName,
      email: values.email,
      phone: values.phone,
      subject: `Vehicle enquiry: ${vehicle}`,
      message: values.details?.trim() || "No additional details.",
      adminEmail: recipient.email,
      tenantId: recipient.tenantId ?? undefined,
    },
  });
  if (error) throw error;
}
