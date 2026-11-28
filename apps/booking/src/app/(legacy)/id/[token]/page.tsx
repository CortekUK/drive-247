'use client';

/**
 * The renter's check page · feat-003 driver verification (spec 06).
 *
 * Our own page first: who is asking, what will be checked, the consents (recorded by us), then Didit's
 * hosted check, then back here. The token in the address is the only key, and nothing private is ever
 * shown here: no licence number, no date of birth, no photo (spec 06.3, 06.7). Trax speaks, first person,
 * no emojis (spec 06.19). Today's /verify/<token> page is a different page and is not changed.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface PageModel {
  state: 'open' | 'ended' | 'replaced' | 'verified' | 'needs_review' | 'failed';
  company: { name: string; logoUrl: string | null };
  firstName: string | null;
  expiresAt: string;
  consentGiven: boolean;
  checkStarted: boolean;
  standardConsent: string;
  premiumConsents: Array<{ key: string; name: string; text: string }>;
  checks: Array<{ key: string; name: string; description: string }>;
}

async function call<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('verification-v2-link', { body });
  if (!error) return { data: data as T, error: null };
  let code = 'server_error';
  try { code = (await (error as { context?: Response }).context?.clone().json())?.error ?? code; } catch { /* not JSON */ }
  return { data: null, error: code };
}

function Shell({ model, children }: { model: PageModel | null; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-5 px-5 py-8 text-[15px] leading-relaxed">
      {model && (
        <header className="flex items-center gap-3">
          {model.company.logoUrl
            ? <img src={model.company.logoUrl} alt="" className="h-10 w-10 rounded-xl object-contain" />
            : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted font-semibold">{model.company.name.slice(0, 1)}</span>}
          <span className="font-semibold">{model.company.name}</span>
        </header>
      )}
      {children}
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-2xl border p-5">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>
    </section>
  );
}

export default function VerifyIdPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const search = useSearchParams();
  const done = search?.get('done') === '1';
  const [model, setModel] = useState<PageModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [premium, setPremium] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [onLaptop, setOnLaptop] = useState(false);
  const [continueHere, setContinueHere] = useState(false);

  const load = useCallback(async () => {
    const r = await call<PageModel>({ action: 'open', token });
    if (r.error) setError(r.error);
    else setModel(r.data);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // A laptop gets the same link as a code to scan (spec 06.17).
  useEffect(() => {
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setOnLaptop(window.innerWidth > 768 && !touch);
  }, []);

  // Back from Didit: keep reading until the result is in.
  useEffect(() => {
    if (!done || !model || model.state !== 'open') return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [done, model, load]);

  const begin = async () => {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      if (!model.consentGiven) {
        const c = await call({ action: 'consent', token, standard: true, premium });
        if (c.error) { setError(c.error); return; }
      }
      const d = await call<{ url: string }>({ action: 'start-didit', token });
      if (d.error || !d.data?.url) { setError(d.error ?? 'provider_unavailable'); return; }
      window.location.href = d.data.url;
    } finally {
      setBusy(false);
    }
  };

  const refuse = async () => {
    setBusy(true);
    await call({ action: 'consent', token, standard: false });
    setBusy(false);
    void load();
  };

  if (error === 'unknown') return <Shell model={null}><Message title="This link is not valid" body="Check you opened the whole link from your email or text." /></Shell>;
  if (error === 'too_many') return <Shell model={model}><Message title="Give me a moment" body="This link was opened a lot in a short time. Try again in ten minutes." /></Shell>;
  if (!model) {
    return <Shell model={null}><p className="text-muted-foreground">{error ? 'I could not load this check. Try again in a minute.' : 'Loading…'}</p></Shell>;
  }

  const company = model.company.name;
  if (model.state === 'replaced') return <Shell model={model}><Message title="This link was replaced" body={`Please use the newest link ${company} sent you.`} /></Shell>;
  if (model.state === 'ended') return <Shell model={model}><Message title="This link has ended" body={`Ask ${company} for a new one.`} /></Shell>;
  if (model.state === 'verified') return <Shell model={model}><Message title="You are verified" body={`Thank you. ${company} has your result.`} /></Shell>;
  if (model.state === 'needs_review') return <Shell model={model}><Message title="Thank you, you are done" body={`${company} will look at your check and be in touch if they need anything.`} /></Shell>;
  if (model.state === 'failed') return <Shell model={model}><Message title="I could not verify you" body={`${company} will be in touch.`} /></Shell>;
  if (done) return <Shell model={model}><Message title="Thank you, you are done" body="I am checking your licence now. You can close this page." /></Shell>;

  if (onLaptop && !continueHere) {
    const here = typeof window !== 'undefined' ? window.location.href : '';
    return (
      <Shell model={model}>
        <section className="rounded-2xl border p-5 text-center">
          <h1 className="text-xl font-semibold">Open this on your phone</h1>
          <p className="mt-2 text-muted-foreground">I need your phone's camera for a photo of your licence and a short selfie. Scan this code with it.</p>
          <div className="mt-4 flex justify-center rounded-xl bg-white p-4"><QRCodeSVG value={here} size={200} /></div>
          <button type="button" className="mt-4 text-sm underline" onClick={() => setContinueHere(true)}>Continue here anyway</button>
        </section>
      </Shell>
    );
  }

  return (
    <Shell model={model}>
      <section className="grid gap-3">
        <h1 className="text-2xl font-semibold">Hi{model.firstName ? ` ${model.firstName}` : ''}, I need to check your licence</h1>
        <p className="text-muted-foreground">
          {company} asked me to check your driving licence before your rental. It takes about a minute: a photo of the front and
          back of your licence, and a short selfie.
        </p>
        <ul className="grid gap-1.5 rounded-2xl border p-4">
          {model.checks.map((c) => (
            <li key={c.key}><span className="font-medium">{c.name}</span><span className="block text-sm text-muted-foreground">{c.description}</span></li>
          ))}
        </ul>
      </section>

      {!model.consentGiven && (
        <section className="grid gap-4">
          <label className="flex items-start gap-3 rounded-2xl border p-4">
            <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} className="mt-1" />
            <span className="text-sm">{model.standardConsent}</span>
          </label>
          {model.premiumConsents.map((p) => (
            <label key={p.key} className="flex items-start gap-3 rounded-2xl border p-4">
              <Checkbox checked={!!premium[p.key]} onCheckedChange={(v) => setPremium((s) => ({ ...s, [p.key]: !!v }))} className="mt-1" />
              <span className="text-sm"><span className="font-medium">{p.name}. </span>{p.text}</span>
            </label>
          ))}
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error === 'provider_unavailable' ? 'The check is busy right now. Try again in a minute.' : 'Something went wrong. Try again.'}
        </p>
      )}

      <div className="mt-auto grid gap-2">
        <Button size="lg" disabled={busy || (!model.consentGiven && !agree)} onClick={() => void begin()}>
          {busy ? 'One moment…' : model.consentGiven ? 'Carry on' : 'Agree and start'}
        </Button>
        {!model.consentGiven && (
          <button type="button" className="text-sm text-muted-foreground underline" disabled={busy} onClick={() => void refuse()}>
            I do not agree
          </button>
        )}
      </div>
    </Shell>
  );
}
