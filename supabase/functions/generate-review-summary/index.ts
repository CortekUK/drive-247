import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    // Verify the user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    // Use service role for data operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { customerId, tenantId } = await req.json();
    if (!customerId) return errorResponse("customerId is required", 400);
    if (!tenantId) return errorResponse("tenantId is required", 400);

    // Fetch all non-skipped reviews for this customer in this tenant
    const { data: reviews, error: reviewsError } = await supabase
      .from("rental_reviews")
      .select(`
        rating,
        comment,
        tags,
        created_at,
        rentals!rental_reviews_rental_id_fkey(
          rental_number,
          start_date,
          end_date,
          vehicles!rentals_vehicle_id_fkey(reg, make, model)
        )
      `)
      .eq("customer_id", customerId)
      .eq("tenant_id", tenantId)
      .eq("is_skipped", false)
      .order("created_at", { ascending: false });

    if (reviewsError) {
      console.error("Error fetching reviews:", reviewsError);
      return errorResponse("Failed to fetch reviews", 500);
    }

    // If no reviews, delete any existing summary
    if (!reviews || reviews.length === 0) {
      await supabase
        .from("customer_review_summaries")
        .delete()
        .eq("customer_id", customerId)
        .eq("tenant_id", tenantId);

      return jsonResponse({ summary: null, deleted: true });
    }

    // Compute stats
    const ratings = reviews.map((r: any) => r.rating).filter(Boolean);
    const averageRating = ratings.length > 0
      ? Math.round((ratings.reduce((sum: number, r: number) => sum + r, 0) / ratings.length) * 10) / 10
      : null;
    const totalReviews = reviews.length;

    // Build prompt for AI summary
    const reviewTexts = reviews.map((r: any) => {
      const rental = r.rentals;
      const vehicle = rental?.vehicles;
      const tags = (r.tags || []).join(", ");
      return `- Rating: ${r.rating}/10${tags ? `, Tags: ${tags}` : ""}${r.comment ? `, Comment: "${r.comment}"` : ""}${vehicle ? `, Vehicle: ${vehicle.make} ${vehicle.model} (${vehicle.reg})` : ""}`;
    }).join("\n");

    const systemPrompt = `You are an internal review summarizer for a car rental company. Generate a concise 2-3 sentence summary of a customer's rental history based on staff reviews. Focus on patterns (positive or negative), reliability, and anything notable. Be factual and professional. This is for internal staff use only — never address the customer directly.`;

    const userPrompt = `Customer has ${totalReviews} review(s) with an average rating of ${averageRating}/10:\n${reviewTexts}\n\nProvide a brief internal summary.`;

    const aiResponse = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, max_tokens: 256 }
    );

    const summaryText = aiResponse.choices[0]?.message?.content?.trim() || "Unable to generate summary.";

    // Upsert into customer_review_summaries
    const { error: upsertError } = await supabase
      .from("customer_review_summaries")
      .upsert(
        {
          customer_id: customerId,
          tenant_id: tenantId,
          summary: summaryText,
          average_rating: averageRating,
          total_reviews: totalReviews,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "customer_id,tenant_id" }
      );

    if (upsertError) {
      console.error("Error upserting summary:", upsertError);
      return errorResponse("Failed to save summary", 500);
    }

    return jsonResponse({
      summary: summaryText,
      average_rating: averageRating,
      total_reviews: totalReviews,
    });
  } catch (error) {
    console.error("Error generating review summary:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
