'use client';

import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Bell,
  Settings,
  MapPin,
  Shield,
  Clock,
  Users,
  CreditCard,
  Ban,
  LayoutTemplate,
  Car,
  AlertOctagon,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import { Tile, Eyebrow, SectionCard, StatusPill } from '@/components/bento';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ─── Reusable primitives (Bento, token-only) ─── */

function MenuItem({
  label,
  active,
  icon: Icon,
}: {
  label: string;
  active?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={`flex h-10 items-center gap-2 rounded-tile-sm px-2 cursor-pointer transition-colors ${
        active
          ? '[background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]'
          : 'text-[color:var(--bento-text-2)] hover:[background:var(--bento-tile-2)]'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-sm">{label}</span>
    </div>
  );
}

function MenuGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <Eyebrow>{title}</Eyebrow>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function HRule() {
  return <div className="h-px w-full bg-border shrink-0" />;
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start w-full">
      <div className="w-full md:w-[304px] shrink-0 flex flex-col gap-1.5">
        <h3 className="text-lg font-bold tracking-tight text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-[250px]">{desc}</p>
      </div>
      <div className="flex-1 max-w-[640px]">{children}</div>
    </div>
  );
}

function PasswordField({ label, hint }: { label: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex w-full max-w-[350px] flex-col gap-1.5">
      <Label className="text-sm font-medium text-[color:var(--bento-text-2)]">{label}</Label>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          placeholder="Enter your password"
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--bento-text-3)]"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/* ─── Page ─── */

export default function PaymentPreviewPage() {
  const [toast, setToast] = useState(true);

  // Force light mode on this page (preview-only behavior, unchanged)
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    return () => {
      document.documentElement.style.colorScheme = '';
    };
  }, []);

  return (
    <div className="relative flex min-h-screen w-full bg-background">
      {/* ══════════ SIDEBAR ══════════ */}
      <aside className="sticky top-0 flex h-screen w-[280px] shrink-0 flex-col justify-between overflow-hidden rounded-r-tile border-r border-border bg-card">
        {/* Back */}
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-tile-sm px-2 py-2 cursor-pointer text-[color:var(--bento-text-2)] hover:[background:var(--bento-tile-2)]">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to Home</span>
          </div>
        </div>

        {/* Nav */}
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3">
          <HRule />
          <MenuGroup title="System Governance">
            <MenuItem label="Audit Logs" icon={Clock} />
            <MenuItem label="Manage Users" icon={Users} />
          </MenuGroup>
          <HRule />
          <MenuGroup title="Business Configuration">
            <MenuItem label="General" icon={Settings} />
            <MenuItem label="Locations" icon={MapPin} />
            <MenuItem label="Insurance" active icon={Shield} />
            <MenuItem label="Reminders" icon={Bell} />
            <MenuItem label="Rental Bookings" icon={Car} />
          </MenuGroup>
          <HRule />
          <MenuGroup title="Financial & Compliance">
            <MenuItem label="Payment" icon={CreditCard} />
            <MenuItem label="Global Blacklist" icon={Ban} />
          </MenuGroup>
          <HRule />
          <MenuGroup title="Marketing & Communications">
            <MenuItem label="Website Content" icon={LayoutTemplate} />
          </MenuGroup>
        </div>

        {/* User */}
        <div className="p-4">
          <div className="flex items-center gap-2 rounded-tile-sm px-2 py-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full [background:var(--bento-tile-2)]">
              <span className="text-sm font-medium text-[color:var(--bento-text-3)]">JD</span>
            </div>
            <span className="flex-1 text-sm text-[color:var(--bento-text-2)]">John Doe</span>
            <ChevronDown className="h-4 w-4 text-[color:var(--bento-text-3)]" />
          </div>
        </div>
      </aside>

      {/* ══════════ MAIN ══════════ */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-20 shrink-0 items-center justify-between px-8 py-3">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-[color:var(--bento-text-2)]" />
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Insurance</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex w-[344px] items-center justify-between rounded-tile-sm border border-border bg-card px-3 py-2">
              <span className="text-sm text-[color:var(--bento-text-2)]">Search for anything</span>
              <div className="flex gap-1">
                {['⌘', 'K'].map((k) => (
                  <div
                    key={k}
                    className="flex h-5 w-5 items-center justify-center rounded [background:var(--bento-tile-2)]"
                  >
                    <span className="font-mono text-xs text-[color:var(--bento-text-3)]">{k}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center rounded-full border border-border [background:var(--bento-tile-2)] p-3">
              <Bell className="h-5 w-5 text-[color:var(--bento-text-2)]" />
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <div className="flex flex-1 flex-col gap-6 px-8 pb-6 pt-1">
          {/* Section 1 — How it works */}
          <Row
            title="How Bonzah Insurance Works"
            desc="Offer rental car insurance to your customers through Bonzah"
          >
            <Tile variant="inset" pad="compact" className="max-w-[400px]">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-[color:var(--bento-text-2)]">
                {[
                  'Complete the Bonzah onboarding form below to register your company with Bonzah',
                  "After approval, you'll receive Bonzah portal credentials (email & password)",
                  'Enter those credentials below and click "Verify & Connect"',
                  'Once connected, your customers will see insurance options during the booking process (Step 3 of the booking widget)',
                  'Insurance premiums are included at checkout — customers pay you through your Stripe Connect account',
                  'At the end of each month, Bonzah sends you an invoice for the insurance premiums, which you pay directly to Bonzah',
                ].map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Tile>
          </Row>

          <HRule />

          {/* Section 2 — Get Insurance */}
          <Row
            title="Get Bonzah Insurance"
            desc="Complete the onboarding application to register your company and acquire your official API credentials."
          >
            <SectionCard
              icon={<Shield className="h-4 w-4" />}
              title={
                <span className="flex items-center gap-2">
                  Register Your Company
                  <StatusPill tone="danger" dot>
                    Not Connected
                  </StatusPill>
                </span>
              }
            >
              <Button>Get Credentials</Button>
            </SectionCard>
          </Row>

          <HRule />

          {/* Section 3 — Connect */}
          <Row
            title="Connect Bonzah"
            desc="Link your verified portal credentials to activate real-time insurance options for your customers during the booking process."
          >
            <SectionCard
              icon={<Shield className="h-4 w-4" />}
              title={
                <span className="flex items-center gap-2">
                  Verify &amp; Link Account
                  <StatusPill tone="danger" dot>
                    Not Connected
                  </StatusPill>
                </span>
              }
            >
              <div className="flex flex-col gap-4">
                <span className="text-sm font-semibold text-foreground">Bonzah Account Details</span>
                <div className="flex w-full max-w-[350px] flex-col gap-1.5">
                  <Label className="text-sm font-medium text-[color:var(--bento-text-2)]">Email</Label>
                  <Input type="email" placeholder="Enter your email" />
                </div>
                <PasswordField
                  label="Password"
                  hint="These credentials are verified against your current API mode."
                />
                <Button>Save &amp; Connect</Button>
              </div>
            </SectionCard>
          </Row>
        </div>

        {/* ── Footer bar ── */}
        <div className="flex shrink-0 items-center justify-end border-t border-border [background:var(--bento-tile-2)] px-8 py-6 shadow-bento">
          <Button>Save Changes</Button>
        </div>
      </div>

      {/* ══════════ TOAST ══════════ */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex w-[356px] items-start gap-3 rounded-tile border border-border bg-card p-4 shadow-bento">
          <AlertOctagon className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--bento-danger-fg)]" />
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">Bonzah Verification Failed</span>
            <span className="text-sm text-muted-foreground">
              Please ensure your email and password match your Bonzah account.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setToast(false)}
            className="shrink-0 text-[color:var(--bento-text-3)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
