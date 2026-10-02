"use client";

/**
 * Edit how to reach this customer — FOR THIS CONVERSATION ONLY.
 *
 * One pencil on the Contact section opens this; the rail itself stays plain.
 * Everything that needs explaining lives here, where the decision is made:
 * that the change is for this chat, that the customer record is untouched,
 * what is on file for each field, and the way back to it.
 *
 * Saved into `contact-override` (this tab, this conversation). Nothing here
 * writes to `customers`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Info, Mail, MessageCircle, MessageSquare, Phone, Plus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";
import {
  looksLikeEmail, looksLikePhone, type ContactOverride, type PreferredChannel,
} from "@/components/messages-v2/contact-override";

const CHANNELS: { key: PreferredChannel; label: string; icon: typeof Mail }[] = [
  { key: "in_app", label: "In-app", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
  { key: "call", label: "Call", icon: Phone },
];

/**
 * One list of ways to reach them — the record's entry first (locked: it is
 * changed on the customer page, not here), then any added for this chat. A
 * round radio picks the one this conversation uses; extras can be removed;
 * "Add" opens an inline field at the foot of the list.
 */
function ContactList({
  title,
  icon: Icon,
  onFile,
  extras,
  selected,
  onSelect,
  onAdd,
  onRemove,
  placeholder,
  validate,
  invalidCopy,
  type,
  addLabel,
}: {
  title: string;
  icon: typeof Mail;
  onFile: string | null;
  extras: string[];
  /** The value in use; null means the record's. */
  selected: string | null;
  onSelect: (v: string | null) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
  validate: (v: string) => boolean;
  invalidCopy: string;
  type: string;
  addLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const entries: { value: string; record: boolean }[] = [
    ...(onFile ? [{ value: onFile, record: true }] : []),
    ...extras.filter((x) => x !== onFile).map((value) => ({ value, record: false })),
  ];
  const inUse = selected ?? onFile;

  function add() {
    const v = draft.trim();
    if (!v) { setAdding(false); return; }
    if (!validate(v)) { setError(invalidCopy); return; }
    onAdd(v);
    setDraft("");
    setAdding(false);
  }

  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-medium">{title}</p>
      <div className="space-y-1" role="radiogroup" aria-label={title}>
        {entries.length === 0 && !adding && (
          <p className="px-1 text-[12px] text-muted-foreground">None on record.</p>
        )}
        {entries.map(({ value, record }) => {
          const on = value === inUse;
          return (
            <div
              key={value}
              className={`group flex items-center gap-2.5 rounded-2xl px-3 py-2 transition-colors duration-200 ease-out motion-reduce:transition-none ${
                on ? "bg-primary/[0.07] dark:bg-[hsl(var(--v2-hover,var(--muted)))]" : "hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.5))]"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onSelect(record ? null : value)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200 ${
                    on ? "border-primary" : "border-muted-foreground/35"
                  }`}
                >
                  {on && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </span>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-[13px]">{value}</span>
              </button>
              {record ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[10.5px] font-medium text-muted-foreground">
                  On record
                </span>
              ) : (
                <>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-px text-[10.5px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                    This chat
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(value)}
                    aria-label={`Remove ${value}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          );
        })}

        {adding ? (
          <div className="px-1 pt-1">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  type={type}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); add(); }
                    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdding(false); }
                  }}
                  placeholder={placeholder}
                  className="h-9 rounded-full pl-9 text-[13px]"
                />
              </div>
              <Button size="sm" className="h-9 rounded-full" onClick={add}>Add</Button>
              <Button size="sm" variant="ghost" className="h-9 rounded-full" onClick={() => { setAdding(false); setDraft(""); setError(null); }}>
                Cancel
              </Button>
            </div>
            {error && <p className="mt-1 px-2 text-[11.5px] text-destructive">{error}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setAdding(true); setDraft(""); setError(null); }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-primary transition-colors duration-200 hover:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function ContactEditDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  onFileEmail,
  onFilePhone,
  usualChannel,
  override,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  onFileEmail: string | null;
  onFilePhone: string | null;
  /** The channel the conversation usually happens on, when nothing is chosen. */
  usualChannel: PreferredChannel;
  override: ContactOverride;
  onSave: (next: ContactOverride) => void;
}) {
  const [emails, setEmails] = useState<string[]>([]);
  const [phones, setPhones] = useState<string[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [channel, setChannel] = useState<PreferredChannel>(usualChannel);

  /* Each open starts from what this chat has right now. */
  useEffect(() => {
    if (!open) return;
    setEmails(override.emails ?? (override.email ? [override.email] : []));
    setPhones(override.phones ?? (override.phone ? [override.phone] : []));
    setEmail(override.email ?? null);
    setPhone(override.phone ?? null);
    setChannel(override.channel ?? usualChannel);
  }, [open, override, usualChannel]);

  function save() {
    onSave({
      emails,
      phones,
      /* null = the record's own value, which is never stored as an override. */
      email: email && email !== onFileEmail ? email : undefined,
      phone: phone && phone !== onFilePhone ? phone : undefined,
      channel: channel !== usualChannel ? channel : undefined,
    });
    onOpenChange(false);
  }

  const first = customerName.split(" ")[0] || "this customer";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Landscape, and bounded: email and phone sit side by side, and the
          dialog never grows past 85% of the window — the lists scroll inside
          their own column (no bar drawn) as numbers are added, so the header,
          the channel picker and the footer stay put. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>How to reach {first}</DialogTitle>
          <DialogDescription>For this conversation.</DialogDescription>
        </DialogHeader>

        {/* The one explanation, where the decision is made. */}
        <div className="flex shrink-0 gap-2.5 rounded-2xl bg-primary/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground/85 dark:bg-[hsl(var(--v2-hover,var(--muted)))]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
          <p>
            Add other numbers or emails and choose which one this chat uses — to text, email or
            call {first} somewhere else for now. {first}&apos;s customer record is{" "}
            <span className="font-semibold">not</span> changed.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 sm:grid-cols-2">
          <div className={`min-h-0 overflow-y-auto overscroll-contain pr-1 ${NO_SCROLLBAR}`}>
          <ContactList
            title="Email"
            icon={Mail}
            type="email"
            onFile={onFileEmail}
            extras={emails}
            selected={email}
            onSelect={setEmail}
            onAdd={(v) => { setEmails((xs) => (xs.includes(v) || v === onFileEmail ? xs : [...xs, v])); setEmail(v === onFileEmail ? null : v); }}
            onRemove={(v) => { setEmails((xs) => xs.filter((x) => x !== v)); if (email === v) setEmail(null); }}
            placeholder="name@example.com"
            validate={looksLikeEmail}
            invalidCopy="That doesn't look like an email address."
            addLabel="Add email"
          />
          </div>
          <div className={`min-h-0 overflow-y-auto overscroll-contain pr-1 ${NO_SCROLLBAR}`}>
          <ContactList
            title="Phone"
            icon={Phone}
            type="tel"
            onFile={onFilePhone}
            extras={phones}
            selected={phone}
            onSelect={setPhone}
            onAdd={(v) => { setPhones((xs) => (xs.includes(v) || v === onFilePhone ? xs : [...xs, v])); setPhone(v === onFilePhone ? null : v); }}
            onRemove={(v) => { setPhones((xs) => xs.filter((x) => x !== v)); if (phone === v) setPhone(null); }}
            placeholder="+1 555 555 0100"
            validate={looksLikePhone}
            invalidCopy="That doesn't look like a phone number."
            addLabel="Add number"
          />
          </div>
        </div>

        <div className="shrink-0">
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium">Usual channel</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Usual channel">
              {CHANNELS.map(({ key, label, icon: Icon }) => {
                const on = channel === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setChannel(key)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors duration-200 ease-out motion-reduce:transition-none ${
                      on
                        ? "bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]"
                        : "text-muted-foreground hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.6))] hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 px-1 text-[11.5px] text-muted-foreground">
              The message box opens on this channel for this chat.
            </p>
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center gap-2 sm:justify-between">
          <Link
            href={`/customers/${customerId}`}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            Change the record instead
            <ExternalLink className="h-3 w-3" />
          </Link>
          <div className="flex gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={save}>
              Use for this chat
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
