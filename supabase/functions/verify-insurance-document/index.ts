// @ts-nocheck - Deno edge function
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Inlined usage logger (mirrors _shared/openai.ts logExternalUsage so this
// edge function can be deployed standalone).
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

async function logUsage(params: {
  functionName: string;
  tenantId?: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  status: "success" | "error";
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const p = PRICING[params.model] ?? PRICING["gpt-4o"];
    const cost =
      (params.promptTokens * p.input + params.completionTokens * p.output) /
      1_000_000;
    await fetch(`${supabaseUrl}/rest/v1/openai_usage_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        tenant_id: params.tenantId ?? null,
        function_name: params.functionName,
        endpoint: "chat/completions",
        model: params.model,
        prompt_tokens: params.promptTokens,
        completion_tokens: params.completionTokens,
        total_tokens: params.totalTokens,
        cost_usd: cost,
        status: params.status,
        duration_ms: params.durationMs,
        error_message: params.errorMessage ?? null,
      }),
    });
  } catch (e) {
    console.error("[usage-log] failed", e);
  }
}

interface VerifyRequest {
  verificationId: string;
}

interface ExtractedFields {
  insurer: string | null;
  policy_number: string | null;
  policy_holder: string | null;
  coverage_type: string | null;
  start_date: string | null;
  end_date: string | null;
  vehicle_info: string | null;
  premium_amount: string | null;
  country: string | null;
}

interface AIResult {
  ai_score: number;
  flags: string[];
  reasoning: string;
  extracted: ExtractedFields;
  is_insurance_document: boolean;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function downloadAsBase64(
  url: string,
  supabase: any,
): Promise<{ base64: string; mime: string } | null> {
  try {
    // Parse Supabase storage URL
    if (url.includes("/storage/v1/object/")) {
      const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
      if (match) {
        const [bucket, ...rest] = match[1].split("/");
        const path = rest.join("/");
        const { data, error } = await supabase.storage
          .from(bucket)
          .download(path);
        if (error || !data) {
          console.error("Storage download error", error);
          return null;
        }
        const buf = await data.arrayBuffer();
        return {
          base64: uint8ArrayToBase64(new Uint8Array(buf)),
          mime: data.type || "image/jpeg",
        };
      }
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return {
      base64: uint8ArrayToBase64(new Uint8Array(buf)),
      mime: res.headers.get("content-type") || "image/jpeg",
    };
  } catch (e) {
    console.error("Download failed", e);
    return null;
  }
}

async function analyzeDocument(
  fileBase64: string,
  mimeType: string,
  tenantId: string,
): Promise<AIResult> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY not configured");

  const prompt = `You are an expert insurance document auditor. Analyze the provided document image and determine:

1. Whether this is genuinely an insurance certificate / policy document (auto, vehicle, rental, or general liability insurance).
2. A legitimacy score from 0 to 100, where:
   - 90-100: Looks fully legitimate (clear insurer branding, policy number, dates, holder, no anomalies)
   - 70-89: Looks legitimate but missing minor details
   - 40-69: Suspicious elements (low quality, inconsistent fonts, unclear branding, suspicious values)
   - 0-39: Likely fake, heavily tampered, or not actually an insurance document
3. Extract structured fields (use null when unsure).
4. List specific flags / red flags you noticed. Examples: "policy number not visible", "dates appear edited", "no insurer logo", "watermark / sample document", "blurry / illegible critical fields", "inconsistent fonts in policy number row".

Return ONLY valid JSON, no markdown, no code blocks:
{
  "is_insurance_document": true | false,
  "ai_score": 0-100,
  "flags": ["short specific flags"],
  "reasoning": "1-3 sentence explanation of the score",
  "extracted": {
    "insurer": "string or null",
    "policy_number": "string or null",
    "policy_holder": "string or null",
    "coverage_type": "string or null (e.g., comprehensive, third-party, collision, liability)",
    "start_date": "YYYY-MM-DD or null",
    "end_date": "YYYY-MM-DD or null",
    "vehicle_info": "string or null (registration, VIN, make/model)",
    "premium_amount": "string or null (include currency if visible)",
    "country": "ISO 3166-1 alpha-2 or null"
  }
}

Be honest. If it's clearly not insurance, set is_insurance_document=false and score<=20.`;

  const startedAt = Date.now();
  const body = {
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a meticulous insurance document auditor. Always respond with valid JSON only, no markdown.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${fileBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 1200,
    temperature: 0.1,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    await logUsage({
      functionName: "verify-insurance-document",
      tenantId,
      model: "gpt-4o",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: "error",
      durationMs: Date.now() - startedAt,
      errorMessage: `${response.status}: ${errorText.slice(0, 500)}`,
    });
    throw new Error(`OpenAI API error: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  await logUsage({
    functionName: "verify-insurance-document",
    tenantId,
    model: "gpt-4o",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    status: "success",
    durationMs: Date.now() - startedAt,
  });

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty OpenAI response");

  const cleaned = content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse AI response: ${cleaned.slice(0, 200)}`);
  }

  const score = Math.max(0, Math.min(100, Number(parsed.ai_score) || 0));
  const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String) : [];
  const ex = parsed.extracted || {};

  return {
    is_insurance_document: parsed.is_insurance_document === true,
    ai_score: score,
    flags,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    extracted: {
      insurer: ex.insurer || null,
      policy_number: ex.policy_number || null,
      policy_holder: ex.policy_holder || null,
      coverage_type: ex.coverage_type || null,
      start_date: ex.start_date || null,
      end_date: ex.end_date || null,
      vehicle_info: ex.vehicle_info || null,
      premium_amount: ex.premium_amount || null,
      country: ex.country || null,
    },
  };
}

function statusFromScore(score: number, isInsurance: boolean): string {
  if (!isInsurance) return "rejected";
  if (score >= 70) return "verified";
  if (score >= 40) return "flagged";
  return "rejected";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let verificationId: string | undefined;
  try {
    const body = (await req.json()) as VerifyRequest;
    verificationId = body.verificationId;
    if (!verificationId) {
      return new Response(
        JSON.stringify({ error: "verificationId required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: row, error: fetchErr } = await supabase
      .from("insurance_verifications")
      .select("id, tenant_id, file_url, mime_type, status")
      .eq("id", verificationId)
      .single();

    if (fetchErr || !row) {
      return new Response(
        JSON.stringify({ error: "Verification not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    await supabase
      .from("insurance_verifications")
      .update({ status: "processing", ai_error: null })
      .eq("id", verificationId);

    const downloaded = await downloadAsBase64(row.file_url, supabase);
    if (!downloaded) {
      await supabase
        .from("insurance_verifications")
        .update({
          status: "failed",
          ai_error: "Could not download file",
        })
        .eq("id", verificationId);
      return new Response(
        JSON.stringify({ error: "Could not download file" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // OpenAI vision doesn't accept PDF directly; flag and bail with a sensible status
    if (
      downloaded.mime.toLowerCase().includes("pdf") ||
      (row.mime_type || "").toLowerCase().includes("pdf")
    ) {
      const msg =
        "PDF preview not supported by AI vision. Please upload an image (JPG/PNG) of the certificate.";
      await supabase
        .from("insurance_verifications")
        .update({
          status: "failed",
          ai_error: msg,
        })
        .eq("id", verificationId);
      return new Response(JSON.stringify({ error: msg }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await analyzeDocument(
      downloaded.base64,
      downloaded.mime,
      row.tenant_id,
    );

    const newStatus = statusFromScore(result.ai_score, result.is_insurance_document);

    const { error: updateErr } = await supabase
      .from("insurance_verifications")
      .update({
        status: newStatus,
        ai_score: result.ai_score,
        ai_findings: {
          flags: result.flags,
          reasoning: result.reasoning,
          is_insurance_document: result.is_insurance_document,
          model: "gpt-4o",
        },
        extracted_fields: result.extracted,
        ai_error: null,
      })
      .eq("id", verificationId);

    if (updateErr) throw updateErr;

    return new Response(
      JSON.stringify({
        ok: true,
        status: newStatus,
        ai_score: result.ai_score,
        flags: result.flags,
        reasoning: result.reasoning,
        extracted: result.extracted,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("verify-insurance-document error:", err);
    if (verificationId) {
      try {
        await supabase
          .from("insurance_verifications")
          .update({
            status: "failed",
            ai_error: err?.message?.slice(0, 500) || "Unknown error",
          })
          .eq("id", verificationId);
      } catch {}
    }
    return new Response(
      JSON.stringify({ error: err?.message || "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
