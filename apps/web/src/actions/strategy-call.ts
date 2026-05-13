"use server";

import { getSupabase } from "@/lib/supabase/server";

export type StrategyCallState = {
  success: boolean;
  message: string;
} | null;

export async function submitStrategyCallAction(
  _prev: StrategyCallState,
  formData: FormData
): Promise<StrategyCallState> {
  const name = formData.get("name");
  const email = formData.get("email");
  const phone = formData.get("phone");
  const fleetSize = formData.get("fleet_size");
  const currentPlatform = formData.get("current_platform");
  const challenge = formData.get("challenge");
  const budget = formData.get("budget");
  const readiness = formData.get("readiness");

  if (!name || typeof name !== "string" || !name.trim()) {
    return { success: false, message: "Please enter your name." };
  }

  if (!email || typeof email !== "string") {
    return { success: false, message: "Please enter your email." };
  }

  const trimmedEmail = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { success: false, message: "Please enter a valid email address." };
  }

  if (!fleetSize || typeof fleetSize !== "string" || !fleetSize.trim()) {
    return { success: false, message: "Please select your fleet size." };
  }

  if (
    !currentPlatform ||
    typeof currentPlatform !== "string" ||
    !currentPlatform.trim()
  ) {
    return { success: false, message: "Please select your current platform." };
  }

  if (!budget || typeof budget !== "string" || !budget.trim()) {
    return { success: false, message: "Please select your launch budget." };
  }

  if (!readiness || typeof readiness !== "string" || !readiness.trim()) {
    return { success: false, message: "Please select your launch readiness." };
  }

  const trimmedPhone =
    typeof phone === "string" ? phone.trim() : undefined;
  const trimmedChallenge =
    typeof challenge === "string" ? challenge.trim() : undefined;

  // Insert contact request
  const { error } = await getSupabase().from("contact_requests").insert({
    contact_name: name.trim(),
    company_name: "Unknown",
    email: trimmedEmail,
    phone: trimmedPhone || null,
    fleet_size: fleetSize.trim(),
    current_platform: currentPlatform.trim(),
    challenge: trimmedChallenge || null,
    budget: budget.trim(),
    readiness: readiness.trim(),
    source: "strategy-call",
    status: "pending",
  });

  if (error) {
    if (process.env.NODE_ENV === "development")
      console.error("Strategy call capture error:", error);
    return {
      success: false,
      message: "Something went wrong. Please try again.",
    };
  }

  // Fire-and-forget confirmation email via edge function
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      fetch(`${supabaseUrl}/functions/v1/send-strategy-call-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          email_type: "confirmation",
          contact_name: name.trim(),
          email: trimmedEmail,
          fleet_size: fleetSize.trim(),
          current_platform: currentPlatform.trim(),
        }),
      }).catch(() => {
        // Fire and forget — don't block on email failure
      });
    }
  } catch {
    // Silently fail — email is non-blocking
  }

  return {
    success: true,
    message: "You're in — pick a time that works.",
  };
}
