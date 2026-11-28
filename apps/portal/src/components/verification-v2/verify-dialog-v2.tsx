"use client";

/**
 * The Verify dialog · feat-003 (specs 04, 05). One dialog, three screens, each asking one thing:
 *   1. What should I check?   the price list as a table, last time's ticks, the total
 *   2. How does <name> do it? email, text, show a code, copy the link
 *   3. <name> is verifying    the moments as they happen, Send again, Cancel, Close
 * A customer with an open check opens straight on screen 3 (spec 04.16). Nothing here holds a price:
 * the list and the rules come from `verification-v2` action `context`.
 */

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Loader2, Mail, MessageSquare, QrCode } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { Input } from "@/components/ui-v2/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useVerificationActions, useVerificationContext, useVerificationStatus } from "@/hooks/use-verification-v2";
import { displayTotal, formatCents, type PriceListRow } from "@/lib/verification-v2/pricing";
import { LINE_LABEL, momentText, RESULT_LABEL, STATUS_LABEL, STATUS_TONE, type ServiceRow } from "@/lib/verification-v2/api";

type Screen = "what" | "how" | "progress";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** Why a row cannot be ticked, or null when it can (spec 04.3 to 04.7, 04.15). */
function blockedReason(s: ServiceRow, ctx: { canTickPremium: boolean; premiumBySubscription: boolean }): string | null {
  if (s.key === "standard") return null;
  if (s.availability === "coming_soon") return "Coming soon";
  if (s.availability === "switched_off") return "Not available yet";
  if (s.kind === "premium" && !ctx.canTickPremium) return "Ask an admin to add premium checks";
  if (s.kind === "premium" && !ctx.premiumBySubscription) return "Subscribe to use premium checks";
  return null;
}

export function VerifyDialogV2({ open, onOpenChange, customerId, customerName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}) {
  const { toast } = useToast();
  const ctxQ = useVerificationContext(customerId, open);
  const statusQ = useVerificationStatus(customerId, open);
  const { start, resend, cancel } = useVerificationActions(customerId);
  const ctx = ctxQ.data;
  const first = (customerName || "the customer").trim().split(/\s+/)[0];

  const [screen, setScreen] = useState<Screen>("what");
  const [ticks, setTicks] = useState<string[]>(["standard"]);
  const [email, setEmail] = useState("");
  const [saveEmail, setSaveEmail] = useState(true);
  const [shownLink, setShownLink] = useState<{ link: string; via: string } | null>(null);

  // Open on screen 3 when a check is already running; otherwise on screen 1 with last time's ticks.
  useEffect(() => {
    if (!open || !ctx) return;
    if (ctx.openSession) {
      setScreen("progress");
      setShownLink({ link: ctx.openSession.link, via: ctx.openSession.sentVia });
    } else {
      setScreen("what");
      setShownLink(null);
      const tickable = ctx.services.filter((s) => s.key === "standard" || !blockedReason(s, ctx)).map((s) => s.key);
      setTicks(["standard", ...ctx.lastTicks.filter((k) => k !== "standard" && tickable.includes(k))]);
    }
    setEmail(ctx.customer.email ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!ctx]);

  const total = useMemo(() => (ctx ? displayTotal(ctx.services as PriceListRow[], ticks, ctx.stateFees) : null), [ctx, ticks]);

  const send = async (sentVia: "email" | "sms" | "qr" | "copy") => {
    try {
      const res = await start.mutateAsync({
        services: ticks, sentVia,
        sendTo: sentVia === "email" ? email.trim() : sentVia === "sms" ? ctx?.customer.phone ?? undefined : undefined,
        saveEmail,
      });
      if (sentVia === "copy") await navigator.clipboard.writeText(res.link).catch(() => undefined);
      if (res.sendError) toast({ title: "The check was made, but not sent", description: `${res.sendError}. Copy the link instead.`, variant: "destructive" });
      else if (sentVia === "copy") toast({ title: "Link copied" });
      setShownLink({ link: res.link, via: sentVia });
      setScreen("progress");
    } catch (e) {
      toast({ title: "Could not start the check", description: (e as Error).message, variant: "destructive" });
    }
  };

  const status = statusQ.data;
  const session = status?.session;
  const finished = status && !["link_sent", "in_progress"].includes(status.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {!ctx ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            {ctxQ.error ? (ctxQ.error as Error).message : <Loader2 className="size-5 animate-spin" />}
          </div>
        ) : screen === "what" ? (
          <>
            <DialogHeader>
              <DialogTitle>What should I check?</DialogTitle>
              {ctx.lastVerifiedAt && (
                <DialogDescription>{first} was verified on {fmtDay(ctx.lastVerifiedAt)}.</DialogDescription>
              )}
            </DialogHeader>
            <div className="overflow-hidden rounded-2xl border">
              {ctx.services.map((s) => {
                const blocked = blockedReason(s, ctx);
                const checked = ticks.includes(s.key);
                const locked = s.key === "standard";
                const fee = s.has_state_fee ? ctx.stateFees[s.key] : 0;
                const price = s.kind === "free" ? "Free"
                  : s.availability !== "live" ? ""
                  : `${formatCents(s.provider_cost_cents + s.margin_cents + (fee ?? 0))}${s.has_state_fee && fee === undefined ? " + state fee" : ""}`;
                return (
                  <label key={s.key} className={cn("flex items-start gap-3 border-b px-4 py-3 last:border-b-0", blocked && !locked ? "opacity-55" : "cursor-pointer")}>
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={locked || !!blocked}
                      onCheckedChange={(v) => setTicks((t) => (v ? [...t, s.key] : t.filter((k) => k !== s.key)))}
                      aria-label={s.name}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.name}{s.kind === "free" ? " · Free" : s.availability === "live" ? " · Premium" : ""}</span>
                      <span className="block text-xs text-muted-foreground">{blocked ?? s.description}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">{price}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Premium checks are added to your next subscription bill. You are only charged for a check the customer finishes.
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">For {first}: {total?.label ?? "Free"}</span>
              <Button onClick={() => setScreen("how")} disabled={!ctx.canStart}>Next</Button>
            </div>
            {!ctx.canStart && <p className="text-xs text-muted-foreground">You can see checks but not start them. Ask an admin.</p>}
          </>
        ) : screen === "how" ? (
          <>
            <DialogHeader>
              <DialogTitle>How does {first} do it?</DialogTitle>
              <DialogDescription>The same link and the same check, whichever way you send it.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="rounded-2xl border p-3">
                <div className="flex items-center gap-2 font-medium"><Mail className="size-4" /> Email the link</div>
                <div className="mt-2 flex gap-2">
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" type="email" aria-label="Email address" />
                  <Button onClick={() => send("email")} disabled={!email.trim() || start.isPending}>Send</Button>
                </div>
                {email.trim().toLowerCase() !== (ctx.customer.email ?? "").toLowerCase() && email.trim() && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={saveEmail} onCheckedChange={(v) => setSaveEmail(!!v)} /> Save this email on the customer
                  </label>
                )}
              </div>
              {ctx.smsAvailable && ctx.customer.phone && (
                <Button variant="outline" className="justify-start" onClick={() => send("sms")} disabled={start.isPending}>
                  <MessageSquare /> Text the link to {ctx.customer.phone}
                </Button>
              )}
              <Button variant="outline" className="justify-start" onClick={() => send("qr")} disabled={start.isPending}>
                <QrCode /> {first} is here: show a code to scan
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => send("copy")} disabled={start.isPending}>
                <Copy /> Copy the link
              </Button>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setScreen("what")}>Back</Button>
              {start.isPending && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{finished ? `${first}'s check` : `${first} is verifying`}</DialogTitle>
              <DialogDescription className={cn(status && STATUS_TONE[status.status])}>
                {status ? STATUS_LABEL[status.status] : "Loading…"}
              </DialogDescription>
            </DialogHeader>
            {!finished && shownLink?.via === "qr" && session?.link && (
              <div className="flex justify-center rounded-2xl bg-white p-4"><QRCodeSVG value={session.link} size={176} /></div>
            )}
            <ol className="grid gap-1.5">
              {(status?.events ?? []).map((e, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#16a34a]" />
                  <span className="flex-1">{momentText(e)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(e.at)}</span>
                </li>
              ))}
            </ol>
            {finished && <ResultLines checks={status?.checks ?? []} />}
            <div className="flex flex-wrap justify-end gap-2">
              {!finished && session && (
                <>
                  <Button variant="outline" disabled={resend.isPending}
                    onClick={async () => {
                      try {
                        const r = await resend.mutateAsync({ sessionId: session.id, sentVia: session.sentVia, sendTo: session.sentTo ?? undefined });
                        if (session.sentVia === "copy") await navigator.clipboard.writeText(r.link).catch(() => undefined);
                        toast({ title: session.sentVia === "copy" ? "Link copied again" : "Sent again" });
                      } catch (e) { toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" }); }
                    }}>Send again</Button>
                  <Button variant="outline" disabled={cancel.isPending}
                    onClick={async () => {
                      try { await cancel.mutateAsync(session.id); toast({ title: "Check cancelled" }); onOpenChange(false); }
                      catch (e) { toast({ title: "Could not cancel", description: (e as Error).message, variant: "destructive" }); }
                    }}>Cancel this check</Button>
                </>
              )}
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One line per check: Pass, Fail, Could not check, with the reason in plain words (spec 07.12 to 07.20). */
export function ResultLines({ checks }: { checks: Array<{ service_key: string; result: string; lines: Array<{ check: string; result: string; reason: string | null }> }> }) {
  const lines = checks.flatMap((c) => (c.lines?.length ? c.lines : [{ check: c.service_key, result: c.result, reason: null }])
    .map((l) => ({ ...l, check: c.service_key === "standard" ? l.check : c.service_key })));
  if (!lines.length) return null;
  return (
    <ul className="grid gap-1 rounded-2xl border p-3">
      {lines.map((l, i) => (
        <li key={i} className="flex items-baseline gap-2 text-sm">
          <span className="w-44 shrink-0">{LINE_LABEL[l.check] ?? l.check}</span>
          <span className={cn("w-28 shrink-0", l.result === "pass" ? "text-[#16a34a]" : l.result === "fail" ? "text-[#dc2626]" : "text-[#d97706]")}>
            {RESULT_LABEL[l.result] ?? l.result}
          </span>
          {l.reason && <span className="text-xs text-muted-foreground">{l.reason}</span>}
        </li>
      ))}
    </ul>
  );
}
