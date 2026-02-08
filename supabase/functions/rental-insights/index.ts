import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";

interface RentalSummary {
  rentalNumber: string;
  customer: string;
  vehicle: string;
  startDate: string;
  endDate: string | null;
  status: string;
  monthlyAmount: number;
  durationDays: number;
}

interface InsightRequest {
  dateRange: { from: string; to: string };
  totalRentals: number;
  totalVehicles: number;
  totalRevenue: number;
  statusBreakdown: Record<string, number>;
  peakDays: string[];
  quietDaysCount: number;
  upcomingStarts: string[];
  endingSoon: string[];
  rentals: RentalSummary[];
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body: InsightRequest = await req.json();

    if (!body.rentals || body.rentals.length === 0) {
      return jsonResponse({
        insights: [],
        summary: "No rental data available for analysis.",
      });
    }

    const rentalsList = body.rentals
      .map(
        (r) =>
          `• ${r.rentalNumber}: ${r.customer} → ${r.vehicle} | ${r.startDate} to ${r.endDate || "ongoing"} | Status: ${r.status} | $${r.monthlyAmount}/mo | ${r.durationDays} days`
      )
      .join("\n");

    const systemPrompt = `You are Trax, an AI scheduling assistant for a car rental business. Your job is to analyze the rental calendar and provide sharp, actionable insights about scheduling, bookings, and operations.

Respond ONLY with valid JSON in this exact format:
{
  "insights": [
    {
      "type": "gap|busy|idle|recommendation",
      "title": "Short punchy title (max 8 words)",
      "description": "Specific actionable detail with dates, customer names, and rental numbers where relevant",
      "severity": "info|warning|success",
      "vehicleRefs": ["REG1"]
    }
  ],
  "summary": "One-sentence scheduling overview"
}

Types:
- "busy": days with many overlapping bookings, back-to-back handovers, or peak periods
- "gap": scheduling gaps — periods with no bookings, turnaround conflicts, or missed opportunities
- "idle": rentals ending soon with no follow-up booking, or long gaps between rentals
- "recommendation": scheduling actions the admin should take — prep for upcoming pickups, chase pending bookings, handle returns

Focus areas (in order of priority):
1. UPCOMING PICKUPS & RETURNS — what needs attention today/this week
2. SCHEDULING CONFLICTS — back-to-back bookings with tight turnarounds
3. BOOKING GAPS — periods where vehicles have no bookings lined up
4. PENDING BOOKINGS — bookings that need approval or follow-up
5. REVENUE IMPACT — high-value bookings to prioritize, cancellation risks

Be specific: mention rental numbers, customer names, dates, and vehicle regs. Do NOT give generic fleet management advice. Every insight must be tied to actual data provided.

Provide 3-5 insights. Keep titles short and punchy.`;

    const userPrompt = `Analyze my rental calendar for ${body.dateRange.from} to ${body.dateRange.to}:

Overview:
- ${body.totalRentals} rentals across ${body.totalVehicles} vehicles
- Status breakdown: ${Object.entries(body.statusBreakdown).map(([s, c]) => `${s}: ${c}`).join(", ")}
- Total monthly revenue: $${body.totalRevenue}
- Busiest days: ${body.peakDays.join(", ") || "N/A"}
- ${body.quietDaysCount} quiet days (≤1 booking)

Upcoming pickups:
${body.upcomingStarts.length > 0 ? body.upcomingStarts.join("\n") : "None scheduled"}

Ending soon (active rentals):
${body.endingSoon.length > 0 ? body.endingSoon.join("\n") : "None ending soon"}

All rentals in this period:
${rentalsList}`;

    const response = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, max_tokens: 1024 }
    );

    const content = response.choices[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return jsonResponse({
          insights: [],
          summary: "Unable to generate insights at this time.",
        });
      }
    }

    return jsonResponse({
      insights: parsed.insights || [],
      summary: parsed.summary || "",
    });
  } catch (err) {
    console.error("rental-insights error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal error",
      500
    );
  }
});
