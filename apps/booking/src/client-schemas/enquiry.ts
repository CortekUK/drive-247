import { z } from "zod";

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const twoYearsOut = () => {
  const d = today();
  d.setFullYear(d.getFullYear() + 2);
  return d;
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

export const enquirySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be less than 100 characters"),
    email: z
      .string()
      .trim()
      .email("Please enter a valid email address")
      .max(255, "Email must be less than 255 characters"),
    phone: z
      .string()
      .trim()
      .refine((val) => {
        const cleaned = val.replace(/[\s\-()]/g, "");
        const digitCount = (cleaned.match(/\d/g) || []).length;
        return digitCount >= 7 && digitCount <= 15;
      }, "Please enter a valid phone number (7-15 digits)"),
    vehicleId: z.string().uuid().nullable().optional(),
    startDate: isoDate,
    endDate: isoDate,
    description: z
      .string()
      .trim()
      .min(10, "Please add at least 10 characters")
      .max(2000, "Description must be less than 2000 characters"),
    hpField: z.string().optional(),
  })
  .refine((d) => Date.parse(d.endDate) >= Date.parse(d.startDate), {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  })
  .refine((d) => Date.parse(d.startDate) >= today().getTime(), {
    path: ["startDate"],
    message: "Start date can't be in the past",
  })
  .refine((d) => Date.parse(d.endDate) <= twoYearsOut().getTime(), {
    path: ["endDate"],
    message: "End date is too far in the future",
  });

export type EnquiryFormValues = z.infer<typeof enquirySchema>;
