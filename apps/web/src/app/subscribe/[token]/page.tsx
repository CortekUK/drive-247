import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// A payment link is not a marketing page. Keep it out of every index — the URL
// carries a bearer credential.
export const metadata: Metadata = {
  title: "Activate your subscription",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}

interface LinkInfo {
  state: string;
  companyName?: string;
  planName?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  trialDays?: number;
  chargeToday?: boolean;
  expiresAt?: string;
  portalUrl?: string;
  tosUrl?: string;
  privacyUrl?: string;
  declined?: boolean;
  error?: string;
}

function money(amount?: number, currency?: string) {
  if (amount == null) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

function hoursLeft(expiresAt?: string): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
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

export default async function SubscribePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = await searchParams;
  const cancelled = sp?.cancelled === "1";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!token || !supabaseUrl || !anonKey) {
    return <Shell title="This link is incomplete">
      <p>Ask your Drive247 contact to send you a fresh link.</p>
    </Shell>;
  }

  const fnBase = `${supabaseUrl}/functions/v1/subscription-link`;
  let info: LinkInfo = { state: "invalid" };
  try {
    const res = await fetch(`${fnBase}?token=${encodeURIComponent(token)}&info=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      cache: "no-store",
    });
    info = (await res.json()) as LinkInfo;
  } catch {
    return <Shell title="We couldn&rsquo;t load this link">
      <p>Please try again in a moment, or ask your Drive247 contact for a fresh link.</p>
    </Shell>;
  }

  const portalHref = info.portalUrl;

  if (info.state === "paid" || info.state === "already_subscribed") {
    return (
      <Shell title="You&rsquo;re all set">
        <p>
          {info.companyName ? <><strong className="text-slate-900">{info.companyName}</strong> is </> : "Your account is "}
          subscribed. Nothing more to do here.
        </p>
        <p>Your login details are in your email. You can sign in whenever you&rsquo;re ready.</p>
        {portalHref && (
          <a href={portalHref} className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800">
            Go to your portal
          </a>
        )}
      </Shell>
    );
  }

  if (info.state === "expired") {
    return (
      <Shell title="This link has expired">
        <p>Payment links stay valid for 24 hours. Ask your Drive247 contact to send a fresh one &mdash; it only takes them a moment.</p>
      </Shell>
    );
  }

  if (info.state === "rate_limited") {
    return (
      <Shell title="This link has been opened too many times">
        <p>For your security we&rsquo;ve stopped this link. Ask your Drive247 contact for a new one.</p>
      </Shell>
    );
  }

  if (info.state === "tenant_suspended") {
    return (
      <Shell title="This account is on hold">
        <p>Please speak to your Drive247 contact before subscribing.</p>
      </Shell>
    );
  }

  if (info.state === "price_changed" || info.state === "account_changed" || info.state === "plan_unavailable") {
    return (
      <Shell title="This link is out of date">
        <p>The plan changed after this link was created, so we&rsquo;ve stopped it rather than charge you the wrong amount. Ask your Drive247 contact for a fresh link.</p>
      </Shell>
    );
  }

  if (info.state !== "ready") {
    return (
      <Shell title="This link isn&rsquo;t valid">
        <p>It may have been replaced by a newer one. Ask your Drive247 contact to send you a fresh link.</p>
      </Shell>
    );
  }

  const price = money(info.amount, info.currency);
  const per = info.interval === "year" ? "year" : "month";
  const chargeToday = info.chargeToday !== false;

  return (
    <Shell title={`Activate ${info.companyName ?? "your subscription"}`}>
      {cancelled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          No charge was made. You can continue whenever you&rsquo;re ready.
        </div>
      )}
      {info.declined && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900">
          That card was declined and you have not been charged. You can try again below.
        </div>
      )}
      {info.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900">{info.error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-slate-900">{info.planName}</span>
          <span className="text-lg font-semibold text-slate-900">{price}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">per {per}, cancel any time</div>
      </div>

      <p>
        {chargeToday
          ? <>You&rsquo;ll be charged <strong className="text-slate-900">{price}</strong> today, then {price} every {per}.</>
          : <>Your card is saved today and nothing is charged yet. Your first payment of <strong className="text-slate-900">{price}</strong> comes later.</>}
      </p>
      <p>Payment is handled by Stripe. We never see your card details.</p>

      <form method="POST" action={`${fnBase}?token=${encodeURIComponent(token)}`} className="space-y-4 pt-1">
        <label className="flex cursor-pointer items-start gap-3 text-slate-700">
          <input type="checkbox" name="accept_terms" value="on" required className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600" />
          <span className="text-xs leading-relaxed">
            I agree to the{" "}
            <a href={info.tosUrl ?? "https://drive-247.com/terms"} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Terms of Service</a>{" "}
            and{" "}
            <a href={info.privacyUrl ?? "https://drive-247.com/privacy"} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Privacy Policy</a>.
          </span>
        </label>
        <button type="submit" className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700">
          Continue to payment
        </button>
      </form>

      <p className="pt-1 text-center text-xs text-slate-400">
        This link {hoursLeft(info.expiresAt)} &middot; do not forward it
      </p>
    </Shell>
  );
}
