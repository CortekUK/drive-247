'use client';

import { useState, useEffect } from 'react';
import { DM_Sans, Inter } from 'next/font/google';
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

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-dm-sans',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-inter',
});

/* ─── Figma raw color tokens ─── */
const c = {
  surfaceVariant: '#f8fafc',
  surface: '#ffffff',
  outline: '#f1f5f9',
  text: '#080812',
  textMid: '#404040',
  textMuted: '#737373',
  primary: '#6366f1',
  primaryBg: '#e0e7ff',
  containerLow: '#f1f5f9',
  containerLowest: '#f8fafc',
  dangerBg: '#fef2f2',
  danger: '#dc2626',
  dark: '#0f172a',
  keyBg: '#f1f5f9',
  keyText: '#64748b',
  avatarBg: '#e2e8f0',
};

/* ─── Reusable primitives ─── */

function MenuItem({
  label,
  active,
  icon: Icon,
}: {
  label: string;
  active?: boolean;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 40,
        padding: '8px 8px',
        borderRadius: 8,
        backgroundColor: active ? c.primaryBg : 'transparent',
        cursor: 'pointer',
      }}
    >
      <Icon
        className="shrink-0"
        style={{
          width: 16,
          height: 16,
          color: active ? c.primary : c.textMid,
          opacity: active ? 1 : 0.6,
        }}
      />
      <span
        className={dmSans.className}
        style={{
          flex: 1,
          fontSize: 14,
          lineHeight: '20px',
          fontWeight: 400,
          color: active ? c.primary : c.textMid,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function MenuGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      <span
        className={dmSans.className}
        style={{ fontSize: 12, lineHeight: '16px', color: c.textMuted }}
      >
        {title}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

function HRule({ width }: { width?: number | string }) {
  return (
    <div
      style={{
        width: width ?? '100%',
        height: 1,
        backgroundColor: c.outline,
        flexShrink: 0,
      }}
    />
  );
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
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', width: '100%' }}>
      <div style={{ width: 304, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3
          className={dmSans.className}
          style={{ fontSize: 18, fontWeight: 500, lineHeight: 'normal', color: c.text, margin: 0 }}
        >
          {title}
        </h3>
        <p
          className={dmSans.className}
          style={{ fontSize: 14, lineHeight: '20px', color: c.textMuted, margin: 0, width: 250 }}
        >
          {desc}
        </p>
      </div>
      <div style={{ flex: 1, maxWidth: 640 }}>{children}</div>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span
      className={inter.className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        lineHeight: '20px',
        backgroundColor: c.dangerBg,
        color: c.danger,
      }}
    >
      {label}
    </span>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 16px',
        borderRadius: 6,
        backgroundColor: c.dark,
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span
        className={inter.className}
        style={{ fontSize: 14, fontWeight: 500, lineHeight: '24px', color: '#fff' }}
      >
        {children}
      </span>
    </button>
  );
}

function Field({
  label,
  placeholder,
  isPassword,
  hint,
}: {
  label: string;
  placeholder: string;
  isPassword?: boolean;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 350 }}>
      <label
        className={dmSans.className}
        style={{ fontSize: 14, fontWeight: 500, lineHeight: '20px', color: c.textMid }}
      >
        {label}
      </label>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 6,
          backgroundColor: c.containerLowest,
        }}
      >
        <input
          type={isPassword && !show ? 'password' : 'text'}
          placeholder={placeholder}
          className={dmSans.className}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 14,
            lineHeight: '20px',
            color: c.textMid,
            padding: 0,
          }}
        />
        {isPassword && (
          <button
            onClick={() => setShow(!show)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          >
            {show ? (
              <EyeOff style={{ width: 16, height: 16, color: c.textMuted }} />
            ) : (
              <Eye style={{ width: 16, height: 16, color: c.textMuted }} />
            )}
          </button>
        )}
      </div>
      {hint && (
        <span
          className={dmSans.className}
          style={{ fontSize: 12, lineHeight: '16px', color: c.textMuted }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/* Bonzah-style inline icon */
function BIcon() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        borderRadius: 9999,
        backgroundColor: c.surface,
        flexShrink: 0,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke={c.danger} strokeWidth="1.5" />
        <path d="M5.5 5L7 4L8.5 5V8.5L7 9.5L5.5 8.5V5Z" fill={c.danger} />
      </svg>
    </span>
  );
}

/* ─── Page ─── */

export default function PaymentPreviewPage() {
  const [toast, setToast] = useState(true);

  // Force light mode on this page
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    return () => {
      document.documentElement.style.colorScheme = '';
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        minHeight: '100vh',
        backgroundColor: c.surfaceVariant,
        position: 'relative',
      }}
    >
      {/* ══════════ SIDEBAR ══════════ */}
      <aside
        style={{
          width: 280,
          height: '100vh',
          position: 'sticky',
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: c.surface,
          borderRight: `1px solid ${c.outline}`,
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Back */}
        <div style={{ padding: '12px 16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 8px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <ArrowLeft style={{ width: 16, height: 16, color: c.textMid }} />
            <span
              className={dmSans.className}
              style={{ fontSize: 14, lineHeight: '20px', color: c.textMid }}
            >
              Back to Home
            </span>
          </div>
        </div>

        {/* Nav */}
        <div
          style={{
            flex: 1,
            padding: '0 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflowY: 'auto',
          }}
        >
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
        <div style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 8px',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 9999,
                backgroundColor: c.avatarBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span
                className={dmSans.className}
                style={{ fontSize: 14, fontWeight: 500, color: c.textMuted }}
              >
                JD
              </span>
            </div>
            <span
              className={`${dmSans.className}`}
              style={{ flex: 1, fontSize: 14, lineHeight: '20px', color: c.textMid }}
            >
              John Doe
            </span>
            <ChevronDown style={{ width: 16, height: 16, color: c.textMuted }} />
          </div>
        </div>
      </aside>

      {/* ══════════ MAIN ══════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Top bar — 80px */}
        <header
          style={{
            height: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 32px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke={c.textMid}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <h1
              className={dmSans.className}
              style={{
                fontSize: 24,
                fontWeight: 500,
                lineHeight: '32px',
                color: '#262626',
                margin: 0,
              }}
            >
              Insurance
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Search */}
            <div
              style={{
                width: 344,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: c.surface,
                border: `1px solid ${c.outline}`,
              }}
            >
              <span
                className={inter.className}
                style={{ fontSize: 14, lineHeight: '20px', color: c.textMid }}
              >
                Search for anything
              </span>
              <div style={{ display: 'flex', gap: 2 }}>
                {['⌘', 'K'].map((k) => (
                  <div
                    key={k}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      backgroundColor: c.keyBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      className={dmSans.className}
                      style={{ fontSize: 12, color: c.keyText }}
                    >
                      {k}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bell */}
            <div
              style={{
                padding: 12,
                borderRadius: 9999,
                backgroundColor: c.containerLowest,
                border: `1px solid ${c.outline}`,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Bell style={{ width: 24, height: 24, color: c.textMid }} />
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            padding: '4px 32px 24px',
          }}
        >
          {/* Section 1 — How it works */}
          <Row
            title="How Bonzah Insurance Works"
            desc="Offer rental car insurance to your customers through Bonzah"
          >
            <div
              style={{
                backgroundColor: c.containerLow,
                borderRadius: 8,
                padding: 8,
                maxWidth: 400,
              }}
            >
              <ul
                className={dmSans.className}
                style={{
                  fontSize: 14,
                  color: c.textMid,
                  lineHeight: 0,
                  margin: 0,
                  paddingLeft: 0,
                  listStyleType: 'disc',
                }}
              >
                {[
                  'Complete the Bonzah onboarding form below to register your company with Bonzah',
                  "After approval, you'll receive Bonzah portal credentials (email & password)",
                  'Enter those credentials below and click "Verify & Connect"',
                  'Once connected, your customers will see insurance options during the booking process (Step 3 of the booking widget)',
                  'Insurance premiums are included at checkout — customers pay you through your Stripe Connect account',
                  'At the end of each month, Bonzah sends you an invoice for the insurance premiums, which you pay directly to Bonzah',
                ].map((t, i) => (
                  <li key={i} style={{ marginLeft: 21, marginBottom: 0 }}>
                    <span style={{ lineHeight: '20px' }}>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Row>

          <HRule width={760} />

          {/* Section 2 — Get Insurance */}
          <Row
            title="Get Bonzah Insurance"
            desc="Complete the onboarding application to register your company and acquire your official API credentials."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ paddingTop: 4 }}>
                  <BIcon />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 400 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      className={dmSans.className}
                      style={{ fontSize: 14, fontWeight: 500, lineHeight: '20px', color: c.text }}
                    >
                      Register Your Company
                    </span>
                    <Badge label="Not Connected" />
                  </div>
                  <Btn>Get Credentials</Btn>
                </div>
              </div>
            </div>
          </Row>

          <HRule width={760} />

          {/* Section 3 — Connect */}
          <Row
            title="Connect Bonzah"
            desc="Link your verified portal credentials to activate real-time insurance options for your customers during the booking process."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Status line */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ paddingTop: 4 }}>
                  <BIcon />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 400 }}>
                  <span
                    className={dmSans.className}
                    style={{ fontSize: 14, fontWeight: 500, lineHeight: '20px', color: c.text }}
                  >
                    Verify &amp; Link Account
                  </span>
                  <Badge label="Not Connected" />
                </div>
              </div>

              {/* Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span
                  className={dmSans.className}
                  style={{ fontSize: 14, fontWeight: 500, lineHeight: '20px', color: c.text }}
                >
                  Bonzah Account Details
                </span>
                <Field label="Email" placeholder="Enter your email" />
                <Field
                  label="Password"
                  placeholder="Enter your password"
                  isPassword
                  hint="These credentials are verified against your current API mode."
                />
              </div>

              <Btn>Save &amp; Connect</Btn>
            </div>
          </Row>
        </div>

        {/* ── Footer bar ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '24px 32px',
            backgroundColor: c.containerLowest,
            borderTop: `1px solid ${c.outline}`,
            boxShadow:
              '0px -14px 8px 0px rgba(0,0,0,0.01), 0px -6px 6px 0px rgba(0,0,0,0.02), 0px -2px 3px 0px rgba(0,0,0,0.02)',
            flexShrink: 0,
          }}
        >
          <Btn>Save Changes</Btn>
        </div>
      </div>

      {/* ══════════ TOAST ══════════ */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 356,
            padding: 16,
            borderRadius: 8,
            backgroundColor: c.surface,
            border: `1px solid ${c.outline}`,
            boxShadow: '0px 1px 3px 0px rgba(0,0,0,0.1), 0px 1px 2px 0px rgba(0,0,0,0.1)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <AlertOctagon
            style={{ width: 24, height: 24, color: c.danger, flexShrink: 0, marginTop: 2 }}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              className={dmSans.className}
              style={{ fontSize: 14, fontWeight: 500, lineHeight: '20px', color: c.text }}
            >
              Bonzah Verification Failed
            </span>
            <span
              className={dmSans.className}
              style={{ fontSize: 14, lineHeight: '20px', color: c.textMuted }}
            >
              Please ensure your email and password match your Bonzah account.
            </span>
          </div>
          <button
            onClick={() => setToast(false)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <X style={{ width: 16, height: 16, color: c.textMuted }} />
          </button>
        </div>
      )}
    </div>
  );
}
