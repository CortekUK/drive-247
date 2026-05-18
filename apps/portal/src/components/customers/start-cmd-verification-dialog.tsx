'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
  Mail,
  MessageSquare,
  Phone,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type CmdChannel,
  type CmdApplicantInput,
  useCreateCmdVerification,
} from '@/hooks/use-cmd-verification';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

interface StartCmdVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    date_of_birth: string | null;
  };
}

type Step = 'details' | 'channels' | 'sending' | 'sent';

function splitName(full: string | null): { firstName: string; lastName: string } {
  if (!full) return { firstName: '', lastName: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function stripNonDigits(s: string): string {
  return s.replace(/\D/g, '');
}

export function StartCmdVerificationDialog({
  open,
  onOpenChange,
  customerId,
  customer,
}: StartCmdVerificationDialogProps) {
  const seed = splitName(customer.name);

  const [step, setStep] = useState<Step>('details');
  const [firstName, setFirstName] = useState(seed.firstName);
  const [lastName, setLastName] = useState(seed.lastName);
  const [email, setEmail] = useState(customer.email ?? '');
  const [phone, setPhone] = useState(stripNonDigits(customer.phone ?? '').slice(-10));
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [channels, setChannels] = useState<CmdChannel[]>(['email']);

  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [deliveredVia, setDeliveredVia] = useState<CmdChannel[]>([]);
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const createMutation = useCreateCmdVerification();

  // Reset when re-opened
  useEffect(() => {
    if (open) {
      const s = splitName(customer.name);
      setFirstName(s.firstName);
      setLastName(s.lastName);
      setEmail(customer.email ?? '');
      setPhone(stripNonDigits(customer.phone ?? '').slice(-10));
      setAddressLine1('');
      setAddressLine2('');
      setCity('');
      setState('');
      setZipCode('');
      setChannels(['email']);
      setStep('details');
      setMagicLink(null);
      setDeliveredVia([]);
      setDeliveryErrors(null);
      setErrorMsg(null);
    }
  }, [open, customer.name, customer.email, customer.phone]);

  const detailsValid = useMemo(() => {
    return (
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,4}$/.test(email) &&
      /^\d{10}$/.test(phone) &&
      addressLine1.trim().length > 0 &&
      city.trim().length >= 3 &&
      /^[A-Z]{2}$/.test(state) &&
      /^\d{5}$/.test(zipCode)
    );
  }, [firstName, lastName, email, phone, addressLine1, city, state, zipCode]);

  const channelsValid = channels.length > 0;

  const toggleChannel = (c: CmdChannel) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const handleSubmit = async () => {
    setErrorMsg(null);
    setStep('sending');
    try {
      const applicant: CmdApplicantInput = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        applicantType: 'Primary',
        applicantEmail: email.trim(),
        phoneNumber: phone,
        mobile: phone,
        state,
        zipCode,
        city: city.trim(),
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || undefined,
      };
      const data = await createMutation.mutateAsync({
        customerId,
        channels,
        applicant,
      });
      setMagicLink(data.magicLink ?? null);
      setDeliveredVia(data.deliveredVia ?? []);
      setDeliveryErrors(data.deliveryErrors ?? null);
      setStep('sent');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Failed to start CMD verification');
      setStep('channels');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="border-b border-border bg-gradient-to-br from-indigo-50 via-white to-indigo-50/40 dark:from-indigo-950/40 dark:via-background dark:to-indigo-950/20 px-6 py-5">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-[17px] font-medium">
                  Verify with CheckMyDriver
                </DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">
                  Sends a secure license-verification link to the customer.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-4 flex items-center gap-1.5">
            <StepDot active={step === 'details'} done={step !== 'details'} label="Details" />
            <StepBar />
            <StepDot active={step === 'channels'} done={step === 'sending' || step === 'sent'} label="Delivery" />
            <StepBar />
            <StepDot active={step === 'sending'} done={step === 'sent'} label="Send" />
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          {step === 'details' && (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                CheckMyDriver requires a verified US address and 10-digit phone for the customer. Fill in any gaps below.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" required>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
                </Field>
                <Field label="Last name" required>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
                </Field>
              </div>
              <Field label="Email" required>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
              </Field>
              <Field label="Mobile phone" required hint="10 digits, US format">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(stripNonDigits(e.target.value).slice(0, 10))}
                  placeholder="5551234567"
                  inputMode="numeric"
                />
              </Field>
              <Field label="Street address" required>
                <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="123 Main St" />
              </Field>
              <Field label="Apt / suite (optional)">
                <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Apt 4B" />
              </Field>
              <div className="grid grid-cols-[1fr_120px_120px] gap-3">
                <Field label="City" required>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Austin" />
                </Field>
                <Field label="State" required>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger>
                      <SelectValue placeholder="State" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="ZIP" required>
                  <Input
                    value={zipCode}
                    onChange={(e) => setZipCode(stripNonDigits(e.target.value).slice(0, 5))}
                    placeholder="78701"
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </div>
          )}

          {step === 'channels' && (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Pick how to send the verification link to {firstName || 'the customer'}. We'll send through every channel you select.
              </p>

              <div className="grid grid-cols-3 gap-3">
                <ChannelOption
                  active={channels.includes('email')}
                  onClick={() => toggleChannel('email')}
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  sublabel={email || '—'}
                  disabled={!email}
                />
                <ChannelOption
                  active={channels.includes('sms')}
                  onClick={() => toggleChannel('sms')}
                  icon={<MessageSquare className="h-4 w-4" />}
                  label="SMS"
                  sublabel={phone ? `+1 ${phone}` : '—'}
                  disabled={!phone}
                />
                <ChannelOption
                  active={channels.includes('whatsapp')}
                  onClick={() => toggleChannel('whatsapp')}
                  icon={<Phone className="h-4 w-4" />}
                  label="WhatsApp"
                  sublabel={phone ? `+1 ${phone}` : '—'}
                  disabled={!phone}
                />
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5 p-3 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200/90">
                <div className="flex gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    The link is valid for 7 days. We'll receive a webhook when the customer completes the flow — the verification card on this page will update automatically.
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="rounded-md border border-rose-200 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/5 p-3 text-[12px] text-rose-700 dark:text-rose-300 flex gap-2">
                  <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>{errorMsg}</div>
                </div>
              )}
            </div>
          )}

          {step === 'sending' && (
            <div className="py-12 flex flex-col items-center text-center">
              <div className="relative">
                <div className="h-12 w-12 rounded-full bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-300" />
                </div>
              </div>
              <h3 className="mt-4 text-[15px] font-medium">Creating verification</h3>
              <p className="mt-1.5 text-[13px] text-muted-foreground max-w-xs">
                Generating the secure link with CheckMyDriver and delivering it via your selected channels.
              </p>
            </div>
          )}

          {step === 'sent' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center py-6">
                <div className="h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                </div>
                <h3 className="mt-4 text-[15px] font-medium">Link sent</h3>
                <p className="mt-1.5 text-[13px] text-muted-foreground max-w-sm">
                  We'll update this card automatically once {firstName || 'the customer'} completes the flow.
                </p>
              </div>

              {deliveredVia.length > 0 && (
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {deliveredVia.map((c) => (
                    <Badge key={c} variant="secondary" className="gap-1 capitalize">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      {c}
                    </Badge>
                  ))}
                </div>
              )}

              {deliveryErrors && Object.keys(deliveryErrors).length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5 p-3 text-[12px] text-amber-900 dark:text-amber-200/90 space-y-1">
                  <div className="font-medium">Some channels failed:</div>
                  {Object.entries(deliveryErrors).map(([k, v]) => (
                    <div key={k}>
                      <span className="capitalize">{k}</span>: {v}
                    </div>
                  ))}
                </div>
              )}

              {magicLink && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Magic link</div>
                  <div className="text-[12px] break-all font-mono text-foreground/80">{magicLink}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-3">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Powered by CheckMyDriver
          </div>
          <div className="flex items-center gap-2">
            {step === 'details' && (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={() => setStep('channels')} disabled={!detailsValid} className="gap-1.5">
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
            {step === 'channels' && (
              <>
                <Button variant="ghost" onClick={() => setStep('details')} className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button onClick={handleSubmit} disabled={!channelsValid || createMutation.isPending} className="gap-1.5">
                  <Send className="h-4 w-4" />
                  Send link
                </Button>
              </>
            )}
            {step === 'sent' && (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-medium text-foreground/80 flex items-center gap-1">
        {label}
        {required && <span className="text-indigo-500">*</span>}
        {hint && <span className="text-[11px] text-muted-foreground font-normal">— {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function ChannelOption({
  active,
  onClick,
  icon,
  label,
  sublabel,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-md border p-3 text-left transition-all',
        active
          ? 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-500/40 dark:bg-indigo-500/10 ring-1 ring-indigo-200 dark:ring-indigo-500/20'
          : 'border-border bg-background hover:bg-muted/40',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <div
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full',
          active
            ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
            : 'bg-muted text-foreground/70'
        )}
      >
        {icon}
      </div>
      <div>
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">{sublabel}</div>
      </div>
      {active && (
        <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-indigo-500" />
      )}
    </button>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          'h-1.5 w-1.5 rounded-full transition-colors',
          active && 'bg-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-500/30',
          done && !active && 'bg-emerald-500',
          !active && !done && 'bg-border'
        )}
      />
      <span
        className={cn(
          'text-[11px] uppercase tracking-wide',
          active ? 'text-indigo-600 dark:text-indigo-300 font-medium' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
    </div>
  );
}

function StepBar() {
  return <div className="h-px w-6 bg-border" />;
}
