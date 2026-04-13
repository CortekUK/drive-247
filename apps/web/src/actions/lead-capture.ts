"use server";

import { supabase } from "@/lib/supabase/server";

export type LeadCaptureState = {
  success: boolean;
  message: string;
} | null;

export async function captureLeadAction(
  _prev: LeadCaptureState,
  formData: FormData
): Promise<LeadCaptureState> {
  const email = formData.get("email");

  if (!email || typeof email !== "string") {
    return { success: false, message: "Please enter an email address." };
  }

  const trimmed = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { success: false, message: "Please enter a valid email address." };
  }

  const { error } = await supabase
    .from("contact_requests")
    .insert({
      contact_name: "Email Lead",
      company_name: "Unknown",
      email: trimmed,
      status: "pending",
    });

  if (error) {
    // Log server-side only in development
    if (process.env.NODE_ENV === "development") console.error("Lead capture error:", error);
    return { success: false, message: "Something went wrong. Please try again." };
  }

  return { success: true, message: "Thanks! We'll be in touch soon." };
}

export async function captureConsultationAction(
  _prev: LeadCaptureState,
  formData: FormData
): Promise<LeadCaptureState> {
  const name = formData.get("name");
  const email = formData.get("email");
  const business = formData.get("business");
  const message = formData.get("message");

  if (!name || typeof name !== "string" || !name.trim()) {
    return { success: false, message: "Please enter your name." };
  }

  if (!email || typeof email !== "string") {
    return { success: false, message: "Please enter an email address." };
  }

  const trimmedEmail = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { success: false, message: "Please enter a valid email address." };
  }

  if (!business || typeof business !== "string" || !business.trim()) {
    return { success: false, message: "Please enter your business name." };
  }

  const { error } = await supabase.from("contact_requests").insert({
    contact_name: name.trim(),
    company_name: business.trim(),
    email: trimmedEmail,
    message: typeof message === "string" ? message.trim() : null,
    status: "pending",
  });

  if (error) {
    if (process.env.NODE_ENV === "development") console.error("Consultation capture error:", error);
    return { success: false, message: "Something went wrong. Please try again." };
  }

  return {
    success: true,
    message: "Thanks! We'll review your details and be in touch within 24 hours.",
  };
}
