import { redirect } from "next/navigation";

/**
 * /pay/plan/<token> — the stable payment link in a payment-plan email
 * (docs/PAYMENT_PLANS_DESIGN.md §8, D8).
 *
 * Lives in the (legacy) group because `pay` is an ORIGINAL_ONLY segment
 * (src/lib/booking-design.ts): payment links are addresses other systems send
 * people to, so every tenant — Northwind included — gets this page, and it
 * needs a root layout. /pay/plan/<token> never collides with /pay/<token>
 * (the installment link): that route matches one segment, this one two.
 *
 * The page does no money logic. It hands the token to the payment-plan-pay
 * edge function, which works out what is owed at this moment and either
 * returns a Stripe Checkout URL (we redirect) or a state to explain. Coming
 * back from Stripe (?session_id=…) it only CONFIRMS — it never opens a second
 * checkout for someone who has just paid.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ cancelled?: string; session_id?: string }>;
}

interface PayAnswer {
  status: string;
  url?: string;
  companyName?: string | null;
  justPaid?: boolean;
  message?: string;
}

async function ask(token: string, sessionId: string | null): Promise<PayAnswer> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !anonKey) return { status: "error" };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/payment-plan-pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ token, ...(sessionId ? { sessionId } : {}) }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as PayAnswer | null;
    if (body && typeof body.status === "string") return body;
    console.error("[/pay/plan] unexpected response", res.status);
    return { status: "error" };
  } catch (err) {
    console.error("[/pay/plan] could not reach payment-plan-pay", err);
    return { status: "error" };
  }
}

export default async function PaymentPlanLinkPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = await searchParams;
  const cancelled = sp?.cancelled === "1";
  const sessionId = typeof sp?.session_id === "string" && sp.session_id ? sp.session_id : null;

  // Cancelled at Stripe: say so and let them choose to try again — do not
  // bounce them straight back into the checkout they just left.
  if (cancelled && !sessionId) {
    return (
      <Shell title="Payment not completed">
        <p>You left the payment page before paying. Nothing has been charged.</p>
        <PayAgain token={token} />
      </Shell>
    );
  }

  const result = await ask(token, sessionId);
  if (result.status === "checkout" && result.url) redirect(result.url);

  const company = result.companyName || "the rental company";
  switch (result.status) {
    case "paid":
      return (
        <Shell title={result.justPaid ? "Payment received — thank you" : "Already paid — thank you"}>
          <p>{result.justPaid ? "Your payment went through. A receipt is on its way from Stripe." : "This payment has already been made. There is nothing more to pay on this link."}</p>
        </Shell>
      );
    case "processing":
      return (
        <Shell title="We're confirming your payment">
          <p>{sessionId ? "Your payment is being confirmed. This usually takes a few seconds — you can safely close this page." : "A payment for this is already in progress. Please check back in a few minutes."}</p>
        </Shell>
      );
    case "nothing_owed":
      return (
        <Shell title="Nothing to pay">
          <p>Your balance already covers this payment. Thank you — there is nothing to pay on this link.</p>
        </Shell>
      );
    case "paused":
      return (
        <Shell title="This payment is on hold">
          <p>Payments on this plan are paused for now. Please contact {company} if you have any questions.</p>
        </Shell>
      );
    case "closed":
      return (
        <Shell title="This link is no longer active">
          <p>This payment has been changed or closed by {company}. If you believe you still owe something, please contact them for a new link.</p>
        </Shell>
      );
    case "invalid":
      return (
        <Shell title="This link has been replaced">
          <p>This payment link is no longer valid. Please use the link in the most recent email we sent you, or contact the rental company for a new one.</p>
        </Shell>
      );
    case "unavailable":
      return (
        <Shell title="Online payment isn't available">
          <p>This payment can't be taken online right now. Please contact {company} to arrange it.</p>
        </Shell>
      );
    default:
      return (
        <Shell title="We couldn't open the payment page">
          <p>{result.message || "Something went wrong on our side. Nothing has been charged. Please try again in a minute."}</p>
          <PayAgain token={token} />
        </Shell>
      );
  }
}

function PayAgain({ token }: { token: string }) {
  return (
    <p style={{ marginTop: 20 }}>
      <a
        href={`/pay/plan/${encodeURIComponent(token)}`}
        style={{ display: "inline-block", background: "#111827", color: "#fff", padding: "10px 18px", borderRadius: 6, textDecoration: "none", fontWeight: 600, fontSize: 14 }}
      >
        Try again
      </a>
    </p>
  );
}

/** Same calm card the installment link page (/pay/[token]) uses, so every payment link looks alike. */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: "32px" }}>
      <div style={{ maxWidth: 480, margin: "80px auto", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 32, color: "#374151", fontSize: 14, lineHeight: 1.5 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 20, color: "#111827" }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}
