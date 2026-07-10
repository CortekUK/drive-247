import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Grades the Bonzah onboarding training quiz server-side. The correct answers
// live in bonzah_quiz_questions.correct_option_index, which is NEVER exposed to
// the client (RLS + answer-omitting view). Only the service-role client here can
// read them. Pass threshold is 80% of active questions correct.
//
// Input:  { answers: { [questionId: string]: number }, submissionId?: string }
// Output: { score, total, passed, results: { [questionId]: boolean } }
//
// If submissionId is provided, the submission's quiz_* + training_completed_at
// columns are stamped (used when re-grading an existing submission). Normal flow
// grades before the submission exists and the client carries the result into the
// insert payload.

const PASS_RATIO = 0.8;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const answers: Record<string, number> = body?.answers ?? {};
    const submissionId: string | undefined = body?.submissionId;

    if (!answers || typeof answers !== "object") {
      return errorResponse("answers object is required", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: questions, error: qError } = await supabase
      .from("bonzah_quiz_questions")
      .select("id, correct_option_index")
      .eq("is_active", true);

    if (qError) {
      console.error("[bonzah-grade-quiz] fetch questions error:", qError);
      return errorResponse("Failed to load quiz", 500);
    }
    if (!questions || questions.length === 0) {
      return errorResponse("No active quiz questions configured", 400);
    }

    const total = questions.length;
    let score = 0;
    const results: Record<string, boolean> = {};
    for (const q of questions) {
      const given = answers[q.id];
      const correct = given === q.correct_option_index;
      results[q.id] = correct;
      if (correct) score += 1;
    }

    const passed = score / total >= PASS_RATIO;

    if (submissionId) {
      const { error: stampError } = await supabase
        .from("bonzah_onboarding_submissions")
        .update({
          quiz_score: score,
          quiz_total: total,
          quiz_passed: passed,
          training_completed_at: new Date().toISOString(),
        })
        .eq("id", submissionId);
      if (stampError) {
        console.error("[bonzah-grade-quiz] stamp error:", stampError);
      }
    }

    return jsonResponse({ score, total, passed, results });
  } catch (error) {
    console.error("[bonzah-grade-quiz] error:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
