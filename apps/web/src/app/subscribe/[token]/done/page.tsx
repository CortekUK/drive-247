import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subscription activated",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ session_id?: string }>;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Drive<span className="text-indigo-600">247</span></div>
        <h1 className="text-xl font-medium text-slate-900">{title}</h1>
        <div className="mt-3 space-y-4 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </main>
  );
}

export default async function SubscribeDonePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sessionId = (await searchParams)?.session_id ?? "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  let state = "paid";
  let portalUrl: string | undefined;
  let companyName: string | undefined;

  if (token && sessionId && supabaseUrl && anonKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/subscription-link?token=${encodeURIComponent(token)}&done=1&session_id=${encodeURIComponent(sessionId)}`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, cache: "no-store" },
      );
      const body = await res.json();
      state = body?.state ?? "paid";
      portalUrl = body?.portalUrl;
      companyName = body?.companyName;
    } catch {
      // Stripe has the money. A read failure on our side must never show a
      // paying customer an error — the webhook settles this independently.
      state = "paid";
    }
  }

  // The card was declined at the 3-D Secure step: the session came back but the
  // subscription never became live. Say so plainly and send them back to retry
  // with the same link, which is still valid.
  if (state === "ready") {
    return (
      <Shell title="That payment didn&rsquo;t go through">
        <p>Your card was declined and <strong className="text-slate-900">you have not been charged</strong>.</p>
        <p>You can try again with the same link &mdash; it&rsquo;s still valid.</p>
        <a href={`/subscribe/${token}`} className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700">
          Try again
        </a>
      </Shell>
    );
  }

  if (state === "invalid") {
    return (
      <Shell title="We couldn&rsquo;t confirm this payment">
        <p>If you completed a payment, it is safe &mdash; your receipt comes from Stripe by email. Please contact your Drive247 representative and they will confirm your account.</p>
      </Shell>
    );
  }

  return (
    <Shell title="You&rsquo;re subscribed">
      <p>
        Thank you &mdash; {companyName ? <><strong className="text-slate-900">{companyName}</strong> is </> : "your account is "}
        now active. Stripe has emailed your receipt.
      </p>
      <p>Your portal login details are in your email. You can sign in whenever you&rsquo;re ready &mdash; there&rsquo;s nothing else to do right now.</p>
      {portalUrl && (
        <a href={portalUrl} className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800">
          Go to your portal
        </a>
      )}
    </Shell>
  );
}
