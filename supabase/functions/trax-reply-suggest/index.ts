/**
 * trax-reply-suggest — Trax's suggested replies for the Messages composer.
 *
 * Input:  { channelId: string, mode: "in_app" | "sms" }
 * Output: { tone: string, replies: [{ style: "friendly" | "detailed" | "next_step", text }] }
 *
 * Reads the conversation, the customer's most relevant rental and its car, and
 * the operator's own policies, then asks the model for three replies written AS
 * the operator: a warm one, an in-depth one that fully answers whatever was
 * asked, and a short one that moves things to the next step. All three match
 * the tone the customer is writing in.
 *
 * Technical questions (mileage, fuel, deposit, lockbox, hours, pickup, return)
 * are answered ONLY from the facts loaded here. Anything not in them is met
 * with "let me check" — a suggestion that invents a price or a policy is worse
 * than none, because it is one Tab away from being sent.
 *
 * TENANT ISOLATION (V2_PLAN §5): this runs with the service role, so it
 * resolves the caller's tenant from their JWT and filters every read by it.
 * The channel must belong to that tenant or the request is refused. Super
 * admins (tenant_id NULL) act on the channel's own tenant.
 *
 * Writes nothing except the usage log `chatCompletion` already keeps. The
 * lockbox CODE is never read — only the public instructions.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion, type ToolDefinition } from "../_shared/openai.ts";

type Mode = "in_app" | "sms";
type Style = "friendly" | "detailed" | "next_step";

const HISTORY = 24;

const TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "suggest_replies",
    description: "Return three reply suggestions for the operator to send to the customer.",
    parameters: {
      type: "object",
      properties: {
        tone: {
          type: "string",
          description: "Two or three words describing the customer's tone, e.g. 'casual, upbeat' or 'worried, urgent'.",
        },
        replies: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              style: { type: "string", enum: ["friendly", "detailed", "next_step"] },
              text: { type: "string" },
            },
            required: ["style", "text"],
          },
        },
      },
      required: ["tone", "replies"],
    },
  },
};

function clean<T extends Record<string, unknown>>(o: T | null | undefined): Record<string, unknown> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const { channelId, mode: rawMode } = (await req.json()) as { channelId?: string; mode?: string };
    if (!channelId) return errorResponse("channelId is required");
    const mode: Mode = rawMode === "sms" ? "sms" : "in_app";

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    /* ── who is asking ─────────────────────────────────────────────────── */
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(jwt);
    if (!auth?.user) return errorResponse("Not signed in", 401);

    const { data: appUser } = await db
      .from("app_users")
      .select("tenant_id, is_super_admin, is_active, name")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();
    if (!appUser || appUser.is_active === false) return errorResponse("Not allowed", 403);

    /* ── the conversation, scoped to the caller's tenant ───────────────── */
    let channelQuery = db
      .from("chat_channels")
      .select("id, tenant_id, customer_id")
      .eq("id", channelId);
    if (!appUser.is_super_admin) channelQuery = channelQuery.eq("tenant_id", appUser.tenant_id);
    const { data: channel } = await channelQuery.maybeSingle();
    if (!channel) return errorResponse("Conversation not found", 404);
    const tenantId: string = channel.tenant_id;

    const [{ data: history }, { data: customer }, { data: tenant }, { data: rentals }] = await Promise.all([
      db
        .from("chat_channel_messages")
        .select("sender_type, content, channel, metadata, created_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY),
      db.from("customers").select("name").eq("id", channel.customer_id).eq("tenant_id", tenantId).maybeSingle(),
      db
        .from("tenants")
        .select(
          "company_name, communication_tone, contact_phone, phone, contact_email, address, business_hours, " +
            "working_hours_enabled, working_hours_always_open, working_hours_open, working_hours_close, timezone, " +
            "currency_code, lockbox_enabled, lockbox_default_instructions, delivery_enabled, fixed_pickup_address, " +
            "fixed_return_address, minimum_rental_age, min_rental_days, security_deposit_enabled, global_deposit_amount, " +
            "deposit_mode",
        )
        .eq("id", tenantId)
        .maybeSingle(),
      db
        .from("rentals")
        .select(
          "rental_number, status, start_date, end_date, pickup_time, return_time, pickup_location, return_location, " +
            "delivery_method, delivery_address, payment_status, deposit_hold_status, deposit_hold_amount, " +
            "is_unlimited_mileage, daily_mileage_override, weekly_mileage_override, monthly_mileage_override, " +
            "vehicles(make, model, year, colour, color, reg, fuel_type, daily_mileage, weekly_mileage, monthly_mileage, " +
            "excess_mileage_rate, lockbox_instructions, description)",
        )
        .eq("tenant_id", tenantId)
        .eq("customer_id", channel.customer_id)
        .order("start_date", { ascending: false })
        .limit(5),
    ]);

    const messages = (history ?? []).reverse();
    const customerName = customer?.name ?? "the customer";
    const firstName = customerName.split(" ")[0];

    /* The rental the conversation is most likely about: the one running now,
       else the next one coming, else the latest. */
    const today = new Date().toISOString().slice(0, 10);
    const list = (rentals ?? []) as Record<string, unknown>[];
    const current =
      list.find((r) => String(r.start_date) <= today && String(r.end_date) >= today && r.status !== "Cancelled") ??
      list.filter((r) => String(r.start_date) > today).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0] ??
      list[0];
    const { vehicles: car, ...rental } = (current ?? {}) as Record<string, unknown> & { vehicles?: Record<string, unknown> };

    const facts = {
      business: clean(tenant as Record<string, unknown>),
      rental: clean(rental),
      vehicle: clean(car),
      other_rentals: list
        .filter((r) => r !== current)
        .map((r) => ({ number: r.rental_number, status: r.status, start: r.start_date, end: r.end_date })),
      today,
    };

    const transcript = messages
      .map((m) => {
        const who = m.sender_type === "customer" ? firstName : "Operator";
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        if (m.channel === "voice" || meta.type === "voice_call") {
          return `[${m.created_at}] ${who}: (${meta.outcome === "missed" ? "missed" : "phone"} call)`;
        }
        const subject = meta.subject ? ` (email, subject: ${meta.subject})` : m.channel === "sms" ? " (sms)" : "";
        return `[${m.created_at}] ${who}${subject}: ${m.content}`;
      })
      .join("\n");

    const limit = mode === "sms" ? 300 : 450;
    const system = `You write reply suggestions for ${tenant?.company_name ?? "a car rental business"}, replying to their customer ${customerName}.
Write AS the operator, in first person ("I" / "we"). Never mention AI, Trax, or that this is a suggestion.

Read the whole conversation first:
- Work out the customer's tone (casual, formal, worried, annoyed, upbeat…) and mirror it: same formality, same warmth, same language. If they are worried or annoyed, be calm and reassuring before anything else.
- Find what they are actually asking or need, including technical questions (mileage allowance, fuel type, deposit and when it is released, lockbox and key handover, pickup/return place and time, hours, extensions, documents).
- Keep the flow: reply to the latest message in context of what was already said. Never repeat something the operator already told them unless they asked again.
- If the operator sent the last message, suggest natural follow-ups instead.

Facts you may use are in the FACTS block. Use them for exact answers (dates, times, car, mileage, deposit, address, hours).
NEVER invent a price, fee, policy, address, time or availability that is not in FACTS. If the answer is not there, say you'll check and get back to them shortly.
Never reveal a lockbox code.

Return exactly three replies, each a different variation:
1. "friendly" — warm and personable, short, sounds like a real person.
2. "detailed" — fuller and more in-depth: answers every part of their question with the relevant facts, anticipates the obvious follow-up, still conversational.
3. "next_step" — brief and action-oriented: confirms and moves to the concrete next step (a time, a link, a call, what to do now).

Rules for every reply: plain text, no emojis unless the customer used them, no placeholders like [name], no sign-off, address them as ${firstName} at most once, at most ${limit} characters${mode === "sms" ? " (this is an SMS — keep it tight)" : ""}.`;

    const user = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nCONVERSATION (oldest first):\n${transcript || "(no messages yet — suggest an opening message about their rental)"}`;

    const completion = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        model: "gpt-4o",
        temperature: 0.6,
        max_tokens: 700,
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "suggest_replies" } },
      },
      { tenantId, functionName: "trax-reply-suggest", metadata: { channelId: channel.id, mode } },
    );

    const call = completion.choices[0]?.message?.tool_calls?.[0];
    if (!call) return errorResponse("No suggestions", 502);
    const parsed = JSON.parse(call.function.arguments) as {
      tone?: string;
      replies?: { style?: string; text?: string }[];
    };

    const order: Style[] = ["friendly", "detailed", "next_step"];
    const replies = (parsed.replies ?? [])
      .filter((r): r is { style: Style; text: string } =>
        !!r.text?.trim() && order.includes(r.style as Style))
      .map((r) => ({ style: r.style, text: r.text.trim().slice(0, limit) }))
      .sort((a, b) => order.indexOf(a.style) - order.indexOf(b.style));

    if (replies.length === 0) return errorResponse("No suggestions", 502);
    return jsonResponse({ tone: parsed.tone ?? null, replies });
  } catch (err) {
    console.error("trax-reply-suggest", err);
    return errorResponse(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});
