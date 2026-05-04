// @ts-nocheck - Deno Edge Function
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { logExternalUsage } from '../_shared/openai.ts';

interface DetectRequest {
  rentalId: string;
}

interface DamageFinding {
  location: string;
  description: string;
  severity: 'minor' | 'moderate' | 'severe';
  confidence: number;
  before_photo_index: number | null;
  after_photo_index: number | null;
}

interface DamageReport {
  has_new_damage: boolean;
  overall_severity: 'none' | 'minor' | 'moderate' | 'severe';
  summary: string;
  findings: DamageFinding[];
}

const MODEL = 'gpt-4o';
const MAX_PHOTOS_PER_SIDE = 12;

// OpenAI Vision accepts only these formats
const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * Detect actual image format from magic bytes.
 * Returns a mime type if recognized, null otherwise.
 */
function detectMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  // ISO BMFF container (AVIF/HEIC/HEIF): bytes 4-7 = "ftyp", bytes 8-11 = brand
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1' || brand === 'heim' || brand === 'heis') return 'image/heic';
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Fetch an image and return a data: URL in a format OpenAI accepts.
 * If the source is AVIF/HEIC or unrecognized, transcode via wsrv.nl proxy → JPEG.
 */
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Image fetch failed:', url, res.status);
      return null;
    }
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const detected = detectMimeFromBytes(bytes);

    if (detected && SUPPORTED_MIMES.has(detected)) {
      return `data:${detected};base64,${bytesToBase64(bytes)}`;
    }

    // Unsupported (AVIF / HEIC / unknown) → transcode via wsrv.nl
    console.log('Transcoding unsupported image:', detected ?? 'unknown', url);
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=jpg&q=85`;
    const proxyRes = await fetch(proxyUrl);
    if (!proxyRes.ok) {
      console.error('Image transcode failed:', proxyRes.status);
      return null;
    }
    const proxyBuffer = await proxyRes.arrayBuffer();
    const proxyBytes = new Uint8Array(proxyBuffer);
    const proxyMime = detectMimeFromBytes(proxyBytes);
    if (!proxyMime || !SUPPORTED_MIMES.has(proxyMime)) {
      console.error('Transcoded image still unsupported:', proxyMime);
      return null;
    }
    return `data:${proxyMime};base64,${bytesToBase64(proxyBytes)}`;
  } catch (err) {
    console.error('Image download error:', err);
    return null;
  }
}

async function callVisionModel(
  givingDataUrls: string[],
  receivingDataUrls: string[],
  apiKey: string,
  tenantId: string | null,
  rentalId: string,
): Promise<{ report: DamageReport; usage: { prompt: number; completion: number; total: number } }> {
  const promptText = `You are an expert vehicle damage inspector. You will see TWO sets of photos for the same rental car:

SET A — HANDOVER (before rental, ${givingDataUrls.length} photo${givingDataUrls.length === 1 ? '' : 's'})
SET B — RETURN (after rental, ${receivingDataUrls.length} photo${receivingDataUrls.length === 1 ? '' : 's'})

Compare the two sets and identify any NEW damage that appears on the return photos but not on the handover photos. Ignore pre-existing damage that appears in both sets. Ignore differences in lighting, angle, dirt, or reflections unless they reveal real damage.

For each new damage you detect, return:
- location: where on the vehicle (e.g., "front bumper, driver side", "rear passenger door", "right rear wheel arch")
- description: short description of the damage (e.g., "horizontal scratch ~10cm", "small dent")
- severity: "minor" (cosmetic only), "moderate" (visible but not structural), or "severe" (structural / panel replacement / safety concern)
- confidence: 0.0–1.0 — how confident you are this is real new damage (lower if photos are blurry, mismatched angles, or you can't be sure)
- before_photo_index: zero-based index of the SET A photo showing the same area without damage (null if no matching before photo)
- after_photo_index: zero-based index of the SET B photo showing the damage (required)

Be strict. Do NOT report:
- Dirt, water spots, dust
- Lighting / reflection differences
- Damage you can also see in handover photos
- Speculation when angles don't match — set low confidence instead

Return ONLY valid JSON in this exact shape, no markdown:
{
  "has_new_damage": boolean,
  "overall_severity": "none" | "minor" | "moderate" | "severe",
  "summary": "1-2 sentence summary for the operator",
  "findings": [
    {
      "location": "string",
      "description": "string",
      "severity": "minor" | "moderate" | "severe",
      "confidence": 0.0,
      "before_photo_index": 0,
      "after_photo_index": 0
    }
  ]
}

If no new damage is found, return has_new_damage=false, overall_severity="none", findings=[], and a summary like "No new damage detected — vehicle returned in similar condition."`;

  const content: any[] = [{ type: 'text', text: promptText }];

  content.push({ type: 'text', text: `--- SET A: HANDOVER PHOTOS (${givingDataUrls.length}) ---` });
  givingDataUrls.forEach((url, i) => {
    content.push({ type: 'text', text: `Handover photo index ${i}:` });
    content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
  });

  content.push({ type: 'text', text: `--- SET B: RETURN PHOTOS (${receivingDataUrls.length}) ---` });
  receivingDataUrls.forEach((url, i) => {
    content.push({ type: 'text', text: `Return photo index ${i}:` });
    content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
  });

  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a meticulous vehicle damage inspector. You only flag damage you can clearly see is new. You return strict JSON with no markdown.',
        },
        { role: 'user', content },
      ],
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    await logExternalUsage({
      context: { functionName: 'detect-vehicle-damage', tenantId, metadata: { rentalId } },
      endpoint: 'chat/completions',
      model: MODEL,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'error',
      durationMs: Date.now() - startedAt,
      errorMessage: `${response.status}: ${errText.slice(0, 500)}`,
    });
    throw new Error(`OpenAI vision call failed: ${response.status} — ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const usage = {
    prompt: data.usage?.prompt_tokens ?? 0,
    completion: data.usage?.completion_tokens ?? 0,
    total: data.usage?.total_tokens ?? 0,
  };

  await logExternalUsage({
    context: {
      functionName: 'detect-vehicle-damage',
      tenantId,
      metadata: { rentalId, giving: givingDataUrls.length, receiving: receivingDataUrls.length },
    },
    endpoint: 'chat/completions',
    model: MODEL,
    promptTokens: usage.prompt,
    completionTokens: usage.completion,
    totalTokens: usage.total,
    status: 'success',
    durationMs: Date.now() - startedAt,
  });

  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty response from vision model');

  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const allowedSeverity = ['minor', 'moderate', 'severe'];
  const findings: DamageFinding[] = Array.isArray(parsed.findings)
    ? parsed.findings
        .filter((f: any) => f && typeof f === 'object')
        .map((f: any) => ({
          location: String(f.location ?? '').slice(0, 200),
          description: String(f.description ?? '').slice(0, 500),
          severity: allowedSeverity.includes(f.severity) ? f.severity : 'minor',
          confidence: typeof f.confidence === 'number' ? Math.min(1, Math.max(0, f.confidence)) : 0.5,
          before_photo_index:
            typeof f.before_photo_index === 'number' && f.before_photo_index >= 0 ? f.before_photo_index : null,
          after_photo_index:
            typeof f.after_photo_index === 'number' && f.after_photo_index >= 0 ? f.after_photo_index : null,
        }))
    : [];

  const overallAllowed = ['none', 'minor', 'moderate', 'severe'];
  const report: DamageReport = {
    has_new_damage: !!parsed.has_new_damage,
    overall_severity: overallAllowed.includes(parsed.overall_severity) ? parsed.overall_severity : 'none',
    summary: String(parsed.summary ?? '').slice(0, 1000),
    findings,
  };

  return { report, usage };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return errorResponse('OPENAI_API_KEY not configured', 500);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return errorResponse('Supabase env not configured', 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing Authorization header', 401);

    const supabase = createClient(supabaseUrl, serviceKey);

    // Identify the calling user (for generated_by)
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const authUserId = userData?.user?.id ?? null;

    const body: DetectRequest = await req.json();
    if (!body?.rentalId) return errorResponse('rentalId is required', 400);

    // Look up rental + tenant
    const { data: rental, error: rentalErr } = await supabase
      .from('rentals')
      .select('id, tenant_id')
      .eq('id', body.rentalId)
      .maybeSingle();
    if (rentalErr) throw rentalErr;
    if (!rental) return errorResponse('Rental not found', 404);

    const tenantId = rental.tenant_id as string | null;

    // Resolve app_user.id from auth user
    let appUserId: string | null = null;
    if (authUserId) {
      const { data: appUser } = await supabase
        .from('app_users')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      appUserId = appUser?.id ?? null;
    }

    // Fetch handovers + photos
    const { data: handovers, error: handoverErr } = await supabase
      .from('rental_key_handovers')
      .select('id, handover_type, photos:rental_handover_photos(file_url, uploaded_at)')
      .eq('rental_id', body.rentalId);
    if (handoverErr) throw handoverErr;

    const giving = handovers?.find((h: any) => h.handover_type === 'giving');
    const receiving = handovers?.find((h: any) => h.handover_type === 'receiving');

    const givingPhotos = ((giving?.photos as any[]) || [])
      .slice()
      .sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime())
      .slice(0, MAX_PHOTOS_PER_SIDE);
    const receivingPhotos = ((receiving?.photos as any[]) || [])
      .slice()
      .sort((a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime())
      .slice(0, MAX_PHOTOS_PER_SIDE);

    if (givingPhotos.length === 0) {
      return errorResponse('No handover (giving) photos to compare against', 400);
    }
    if (receivingPhotos.length === 0) {
      return errorResponse('No return (receiving) photos to compare', 400);
    }

    // Download all images in parallel and base64-encode
    const [givingDataUrls, receivingDataUrls] = await Promise.all([
      Promise.all(givingPhotos.map((p: any) => fetchImageAsDataUrl(p.file_url))),
      Promise.all(receivingPhotos.map((p: any) => fetchImageAsDataUrl(p.file_url))),
    ]);

    const validGiving = givingDataUrls.filter((u): u is string => !!u);
    const validReceiving = receivingDataUrls.filter((u): u is string => !!u);

    if (validGiving.length === 0 || validReceiving.length === 0) {
      return errorResponse('Failed to download handover/return images', 502);
    }

    const { report } = await callVisionModel(validGiving, validReceiving, apiKey, tenantId, body.rentalId);

    // Upsert into rental_damage_reports
    const { data: saved, error: saveErr } = await supabase
      .from('rental_damage_reports')
      .upsert(
        {
          rental_id: body.rentalId,
          tenant_id: tenantId,
          generated_by: appUserId,
          summary: report.summary,
          findings: report.findings,
          overall_severity: report.overall_severity,
          has_new_damage: report.has_new_damage,
          giving_photo_count: validGiving.length,
          receiving_photo_count: validReceiving.length,
          model: MODEL,
          generated_at: new Date().toISOString(),
          // Reset reviewer fields on regeneration
          reviewed_by: null,
          reviewed_at: null,
          reviewer_notes: null,
        },
        { onConflict: 'rental_id' },
      )
      .select()
      .single();

    if (saveErr) throw saveErr;

    return jsonResponse({ success: true, report: saved });
  } catch (err) {
    console.error('[detect-vehicle-damage] error:', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg, 500);
  }
});
