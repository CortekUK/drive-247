"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarClock, SkipForward, MoveRight, CalendarCheck, Undo2, FileSignature, ShieldCheck, Mail, Eye, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface OccurrenceOverride {
  sendAgreement?: boolean;
  buyInsurance?: boolean;
  sendEmail?: boolean;
  emailSubject?: string;
  emailBody?: string;
}

interface OccurrenceConfigDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dateKey: string | null;
  isRenewal: boolean;
  exceptionType: "skip" | "move" | null;
  override: OccurrenceOverride;
  defaults: { emailSubject: string; emailBody: string; rateLabel: string; companyName: string; customerName: string; periodLabel: string };
  onSkip: () => void;
  onMove: () => void;
  onMakeNext: () => void;
  onSetNext: () => void;
  onUndo: () => void;
  onChangeOverride: (cfg: OccurrenceOverride) => void;
}

function keyToDate(k: string) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }

function ScheduleBtn({ icon, label, desc, onClick, tone }: { icon: React.ReactNode; label: string; desc: string; onClick: () => void; tone: "rose" | "amber" | "violet" }) {
  const t = tone === "rose" ? "hover:border-rose-400/60 text-rose-500" : tone === "amber" ? "hover:border-amber-400/60 text-amber-500" : "hover:border-violet-400/60 text-violet-500";
  return (
    <button type="button" onClick={onClick} className={cn("flex-1 min-w-[150px] text-left rounded-lg border p-3 transition-colors hover:bg-muted/40", t.split(" ")[0])}>
      <div className={cn("flex items-center gap-1.5 text-sm font-medium", t.split(" ")[1])}>{icon}{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</div>
    </button>
  );
}

export function OccurrenceConfigDialog({
  open, onOpenChange, dateKey, isRenewal, exceptionType, override, defaults,
  onSkip, onMove, onMakeNext, onSetNext, onUndo, onChangeOverride,
}: OccurrenceConfigDialogProps) {
  const [editEmail, setEditEmail] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  if (!dateKey) return null;
  const dateLabel = format(keyToDate(dateKey), "EEE dd MMM yyyy");

  const sendEmail = override.sendEmail !== false;
  const sendAgreement = !!override.sendAgreement;
  const buyInsurance = !!override.buyInsurance;
  const subject = override.emailSubject ?? defaults.emailSubject;
  const body = override.emailBody ?? defaults.emailBody;
  const patch = (p: Partial<OccurrenceOverride>) => onChangeOverride({ ...override, ...p });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-violet-600" />Renewal · {dateLabel}</DialogTitle>
          <DialogDescription>Adjust the schedule and configure exactly what happens for this one renewal.</DialogDescription>
        </DialogHeader>

        {/* Schedule */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Schedule</div>
          {exceptionType ? (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">This renewal is <span className={exceptionType === "skip" ? "text-rose-500" : "text-amber-500"}>{exceptionType === "skip" ? "skipped" : "moved"}</span>.</span>
              <Button variant="outline" size="sm" onClick={onUndo} className="gap-1.5"><Undo2 className="h-3.5 w-3.5" />Undo</Button>
            </div>
          ) : isRenewal ? (
            <div className="flex flex-wrap gap-2">
              <ScheduleBtn tone="rose" icon={<SkipForward className="h-3.5 w-3.5" />} label="Skip" desc="No charge this period; next jumps forward." onClick={onSkip} />
              <ScheduleBtn tone="amber" icon={<MoveRight className="h-3.5 w-3.5" />} label="Move…" desc="Relocate just this one to another date." onClick={onMove} />
              <ScheduleBtn tone="violet" icon={<CalendarCheck className="h-3.5 w-3.5" />} label="Make next" desc="Re-base the whole schedule from here." onClick={onMakeNext} />
            </div>
          ) : (
            <ScheduleBtn tone="violet" icon={<CalendarCheck className="h-3.5 w-3.5" />} label="Set as next renewal" desc="Make this the next charge; the cadence continues from here." onClick={onSetNext} />
          )}
        </div>

        {isRenewal && !exceptionType && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What happens on this renewal</div>

              {/* Email */}
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><Mail className="h-4 w-4 text-blue-500" />Email the customer a pay-link</div>
                  <Switch checked={sendEmail} onCheckedChange={(v) => patch({ sendEmail: v })} />
                </div>
                {sendEmail && (
                  <div className="space-y-2">
                    <button type="button" onClick={() => setEditEmail((e) => !e)} className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:underline"><Pencil className="h-3 w-3" />{editEmail ? "Hide email editor" : "Edit this email"}</button>
                    {editEmail && (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Subject</Label>
                          <Input value={subject} onChange={(e) => patch({ emailSubject: e.target.value })} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Message</Label>
                          <Textarea value={body} onChange={(e) => patch({ emailBody: e.target.value })} rows={5} className="text-sm" />
                          <p className="text-[11px] text-muted-foreground">The Pay-now button + amount are added automatically.</p>
                        </div>
                        {(override.emailSubject != null || override.emailBody != null) && (
                          <Button variant="ghost" size="sm" onClick={() => patch({ emailSubject: undefined, emailBody: undefined })} className="text-xs h-7">Reset to default</Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Agreement */}
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><FileSignature className="h-4 w-4 text-emerald-500" />Send a new rental agreement</div>
                  <Switch checked={sendAgreement} onCheckedChange={(v) => patch({ sendAgreement: v })} />
                </div>
                {sendAgreement && (
                  <div className="space-y-2">
                    <button type="button" onClick={() => setShowAgreement((s) => !s)} className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:underline"><Eye className="h-3 w-3" />{showAgreement ? "Hide preview" : "Preview agreement"}</button>
                    {showAgreement && (
                      <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed space-y-1.5">
                        <p className="font-semibold">Rental Agreement — Renewal ({dateLabel})</p>
                        <p>This agreement renews {defaults.customerName || "the customer"}'s rental with <strong>{defaults.companyName}</strong> for one more {defaults.periodLabel}, at <strong>{defaults.rateLabel}</strong>.</p>
                        <p className="text-muted-foreground">The customer will receive it to e-sign before the period begins. Full terms come from your tenant agreement template.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Insurance */}
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-indigo-500" />Buy insurance for this period</div>
                  <Switch checked={buyInsurance} onCheckedChange={(v) => patch({ buyInsurance: v })} />
                </div>
                {buyInsurance && <p className="text-[11px] text-muted-foreground mt-2">A Bonzah policy for this period is added to the renewal charge.</p>}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button onClick={() => onOpenChange(false)} className="bg-violet-600 hover:bg-violet-700 text-white">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
