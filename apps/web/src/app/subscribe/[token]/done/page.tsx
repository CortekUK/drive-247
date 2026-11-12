import type { Metadata } from "next";
import { mockDoneAnswer } from "@/lib/subscribe-link-mock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subscription activated",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ session_id?: string; v?: string }>;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // Phones (below sm): the card starts near the top instead of floating mid-screen,
    // with one gutter instead of page gutter + 32px card padding (boss, 2026-11-12).
    // sm and up keep the original centred card exactly.
    <main className="min-h-screen bg-slate-50 flex items-start justify-center px-3 py-5 sm:items-center sm:px-4 sm:py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 text-2xl font-semibold sm:mb-6 tracking-tight text-slate-900">Drive<span className="text-indigo-600">247</span></div>
        <h1 className="text-xl font-medium text-slate-900">{title}</h1>
        <div className="mt-3 space-y-4 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </main>
  );
}

export default async function SubscribeDonePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = await searchParams;
  const sessionId = sp?.session_id ?? "";
  // A checkout that carried a Drive247 promo code was minted by
  // subscription-link-v2 (it adds v=2), which also records the code on return.
  const fn = sp?.v === "2" ? "subscription-link-v2" : "subscription-link";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  // Default to "unknown", NOT "paid". Stripe always returns here WITH a
  // session_id; arriving without one means we have no evidence of a payment, and
  // the old default made /subscribe/<anything>/done announce a subscription to
  // anyone who typed the URL — including for tenants with no subscription at all.
  let state = "unknown";
  let portalUrl: string | undefined;
  let companyName: string | undefined;

  // Dev only: a `mock-*` token fakes Stripe's return leg (lib/subscribe-link-mock.ts).
  const mock = mockDoneAnswer(token);
  if (mock) {
    state = mock.state;
    portalUrl = mock.portalUrl;
    companyName = mock.companyName;
  } else if (token && sessionId && supabaseUrl && anonKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/${fn}?token=${encodeURIComponent(token)}&done=1&session_id=${encodeURIComponent(sessionId)}`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, cache: "no-store" },
      );
      const body = await res.json();
      state = body?.state ?? "paid";
      portalUrl = body?.portalUrl;
      companyName = body?.companyName;
    } catch {
      // We DID get a session id back from Stripe, so a payment almost certainly
      // happened and only our read failed. The webhook settles independently, so
      // reassure rather than alarm — but this branch requires the session id.
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

  // No session id: we cannot claim anything. Say so honestly.
  if (state === "unknown") {
    return (
      <Shell title="Nothing to confirm here">
        <p>This page shows the result of a payment, and we haven&rsquo;t got one to show.</p>
        <p>
          If you were paying just now, your receipt comes from Stripe by email. If you still need to pay,
          open the link your Drive247 contact sent you.
        </p>
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
