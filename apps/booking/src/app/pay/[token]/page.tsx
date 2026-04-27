import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}

export default async function MagicLinkPayPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = await searchParams;
  const cancelled = sp?.cancelled === "1";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!token || !supabaseUrl || !anonKey) {
    return (
      <Shell title="Link missing">
        <p>This payment link is incomplete or this site is not configured for installments.</p>
      </Shell>
    );
  }

  // Resolve the magic-link → Stripe Checkout via the edge fn. We fetch with
  // redirect:manual so we can read the Location header and forward the user
  // straight to Stripe via Next's redirect().
  const fnUrl = `${supabaseUrl}/functions/v1/installment-pay-link?token=${encodeURIComponent(token)}`;
  let checkoutUrl: string | null = null;
  let errorBody: string | null = null;
  try {
    const res = await fetch(fnUrl, {
      method: "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      redirect: "manual",
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      checkoutUrl = loc;
    } else {
      // Don't bubble raw HTML up to the user — extract a meaningful line if we can,
      // otherwise just record the status. The full body is server-side only.
      const raw = await res.text().catch(() => "");
      const titleMatch = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const friendly = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      errorBody = friendly || `Status ${res.status}`;
      console.error("[/pay/[token]] edge fn returned non-redirect:", res.status, raw.slice(0, 400));
    }
  } catch (err: any) {
    errorBody = err?.message ?? "Network error reaching the payment service.";
  }

  if (checkoutUrl) {
    redirect(checkoutUrl);
  }

  return (
    <Shell title={cancelled ? "Payment cancelled" : "Couldn't open payment"}>
      {cancelled ? (
        <p>You cancelled the payment. You can return to this link any time before the next reminder to try again.</p>
      ) : (
        <>
          <p>We couldn't open the payment page just now. The link may be expired, the plan may already be settled, or there may be a temporary issue.</p>
          {errorBody ? <p className="mt-3 text-xs" style={{ color: "#94a3b8" }}>{errorBody}</p> : null}
        </>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: "32px" }}>
      <div style={{ maxWidth: 480, margin: "80px auto", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 32, color: "#374151" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 20, color: "#111827" }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}
