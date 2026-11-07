"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useReveal } from "./operations-dashboard";
import { ACC, CARD, DEEP, H, INK, MID, ON, SOFT, Shot, Sparkle, TEXT, Tick, Uid, W, WARM, outline } from "./verify-art";
import "./verify-art.css";

/* Text on the pale fills keeps the deep ink in both themes, or it washes out in dark. */
const ON_PALE = "#2e2a8f";

/*
 * Insurance, Agreements and Payments, drawn and real together, the same way as ID
 * verification (verify-art.tsx): each of a feature's three points gets a drawing of what
 * happens, in the Launch section's style, beside the real portal screen it leads to.
 *
 * The screens are in public/v2/features, light and dark. Six are captured from the portal's
 * demo records (/playground/rental-create-fake and /playground/customer-detail-fake, no real
 * customer): the Bonzah policy, the uploaded insurance certificate, the agreement timeline
 * and what it says, the charges and the deposit. Three are crops of the real captures this
 * page already shows: the Insurances page, Template Studio and Insights.
 *
 * Scroll drives `step` (0, 1, 2: the feature's three points) while the section holds;
 * anywhere else it plays through on its own.
 */

export type ArtTone = "insurance" | "agreements" | "payments";

const STEP_MS = 3200;

/* ── shared pieces ─────────────────────────────────────────────────────── */

function Link({ d }: { d: string }) {
  return <path className="va-link" d={d} stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 9" />;
}

/* A shield, centred on cx, its point about r below cy. */
function Shield({ cx, cy, r, fill = ACC, check = true, className }: { cx: number; cy: number; r: number; fill?: string; check?: boolean; className?: string }) {
  const d = `M${cx} ${cy - r}L${cx + r * 0.86} ${cy - r * 0.62}V${cy + r * 0.06}C${cx + r * 0.86} ${cy + r * 0.62} ${cx + r * 0.42} ${cy + r * 0.96} ${cx} ${cy + r * 1.12}C${cx - r * 0.42} ${cy + r * 0.96} ${cx - r * 0.86} ${cy + r * 0.62} ${cx - r * 0.86} ${cy + r * 0.06}V${cy - r * 0.62}Z`;
  return (
    <g className={className}>
      <path d={d} fill={fill} {...outline} />
      {check && <path d={`m${cx - r * 0.36} ${cy + r * 0.04} ${r * 0.26} ${r * 0.26} ${r * 0.48} ${-r * 0.5}`} stroke={ON} strokeWidth={Math.max(2.4, r * 0.13)} strokeLinecap="round" strokeLinejoin="round" />}
    </g>
  );
}

/* A phone, its screen inset, with whatever it shows. */
function Phone({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={28} fill={DEEP} {...outline} />
      <rect x={x + 9} y={y + 9} width={w - 18} height={h - 18} rx={21} fill={CARD} {...outline} />
      <rect x={x + w / 2 - 20} y={y + 18} width={40} height={7} rx={3.5} fill={DEEP} />
      {children}
    </g>
  );
}

/* A page: thick edge, folded corner. */
function Page({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  const f = 26;
  return (
    <g>
      <path d={`M${x + 6} ${y + 8}h${w - f}l${f} ${f}v${h - f}h-${w}Z`} fill={DEEP} {...outline} />
      <path d={`M${x} ${y}h${w - f}l${f} ${f}v${h - f}h-${w}Z`} fill={CARD} {...outline} />
      <path d={`M${x + w - f} ${y}v${f}h${f}`} fill={SOFT} {...outline} />
      {children}
    </g>
  );
}

/* A payment card. */
function PayCard({ x, y, w = 150, rot = 0, className }: { x: number; y: number; w?: number; rot?: number; className?: string }) {
  const h = w * 0.63;
  return (
    <g className={className} transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
      <rect x={x + 5} y={y + 7} width={w} height={h} rx={12} fill={DEEP} {...outline} />
      <rect x={x} y={y} width={w} height={h} rx={12} fill={ACC} {...outline} />
      <rect x={x + 1} y={y + h * 0.18} width={w - 2} height={h * 0.17} fill={DEEP} />
      <rect x={x + w * 0.1} y={y + h * 0.48} width={w * 0.18} height={h * 0.22} rx={3} fill={WARM} {...outline} strokeWidth={1.4} />
      <path d={`M${x + w * 0.38} ${y + h * 0.56}h${w * 0.48}M${x + w * 0.38} ${y + h * 0.72}h${w * 0.28}`} stroke={ON} strokeOpacity={0.7} strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}

function Line({ x, y, w, fill = MID, h = 9 }: { x: number; y: number; w: number; fill?: string; h?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />;
}

/* ── insurance ─────────────────────────────────────────────────────────── */

/* Cover added at checkout, from the car and the dates. */
function CoverScene() {
  return (
    <g>
      <rect x={42} y={54} width={270} height={214} rx={18} fill={DEEP} {...outline} />
      <rect x={36} y={46} width={270} height={214} rx={18} fill={CARD} {...outline} />
      <path d="M36 84V64a18 18 0 0 1 18-18h234a18 18 0 0 1 18 18v20Z" fill={ACC} {...outline} />
      <text x={58} y={71} fontSize={15} fontWeight={700} letterSpacing="-0.01em" fill={ON}>Checkout</text>
      <Line x={58} y={102} w={128} fill={DEEP} />
      <Line x={58} y={121} w={84} />
      <text x={284} y={112} textAnchor="end" fontSize={14} fontWeight={700} fill={TEXT}>$380</text>
      <path d="M58 146H284" stroke={MID} strokeWidth={2} strokeLinecap="round" />
      <Shield cx={72} cy={174} r={14} check={false} />
      <text x={96} y={176} fontSize={14} fontWeight={700} letterSpacing="-0.01em" fill={TEXT}>Bonzah cover</text>
      <text x={96} y={194} fontSize={11.5} fill={TEXT} opacity={0.7}>Priced for the dates</text>
      <rect x={236} y={166} width={48} height={26} rx={13} fill={ACC} {...outline} />
      <circle className="va-knob" cx={271} cy={179} r={9} fill={ON} />
      <path d="M58 212H284" stroke={MID} strokeWidth={2} strokeLinecap="round" />
      <text x={58} y={240} fontSize={14} fontWeight={700} fill={TEXT}>Total</text>
      <text x={284} y={241} textAnchor="end" fontSize={17} fontWeight={800} letterSpacing="-0.02em" fill={TEXT}>$436</text>

      <Shield cx={330} cy={116} r={44} fill={DEEP} className="va-pop" />
      <Sparkle x={378} y={62} r={8} />
      <Sparkle x={396} y={86} r={4} fill={WARM} />
      <Sparkle x={24} y={300} r={6} fill={MID} />

      <Link d="M290 182C356 192 384 236 398 290" />
      <Shot name="features/ins-policy" x={200} y={318} w={420} ratio={960 / 370} cssWidth={480} label />
    </g>
  );
}

/* Or the renter uploads their own policy, and it is read for them. */
function UploadScene() {
  return (
    <g>
      <Phone x={40} y={36} w={170} h={300}>
        <text x={125} y={86} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={TEXT}>Your insurance</text>
        <rect x={76} y={102} width={98} height={120} rx={10} fill={SOFT} {...outline} />
        <Line x={90} y={122} w={52} fill={DEEP} h={8} />
        <Line x={90} y={140} w={70} h={7} />
        <Line x={90} y={156} w={58} h={7} />
        <Shield cx={125} cy={190} r={13} />
        <rect x={68} y={264} width={114} height={34} rx={17} fill={ACC} {...outline} />
        <path d="M103 288v-12m-6 6 6-6 6 6" stroke={ON} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        <text x={118} y={286} fontSize={13} fontWeight={700} fill={ON}>Upload</text>
      </Phone>

      {/* The certificate, on its way in and being read */}
      <g className="va-fly">
        <Page x={250} y={52} w={120} h={150}>
          <Line x={266} y={84} w={66} fill={DEEP} h={8} />
          <Line x={266} y={102} w={78} h={7} />
          <Line x={266} y={118} w={60} h={7} />
          <Line x={266} y={134} w={72} h={7} />
          <Shield cx={308} cy={170} r={14} fill={WARM} check={false} />
        </Page>
        <path d="M240 50V40h12M378 40h12v10M390 194v10h-12M252 204h-12v-10" stroke={ACC} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <Link d="M214 176C226 160 230 148 240 140" />
      <Sparkle x={410} y={70} r={8} />
      <Sparkle x={428} y={94} r={4} fill={WARM} />

      <Link d="M214 300C220 296 212 290 206 284" />
      <Shot name="features/ins-upload" x={196} y={278} w={430} ratio={1040 / 598} cssWidth={520} label />
    </g>
  );
}

/* Every policy, Bonzah's and uploaded ones, in one place. */
function ListScene() {
  const cards = [
    { x: 52, y: 64, rot: -10, band: WARM },
    { x: 84, y: 88, rot: -3, band: DEEP },
    { x: 118, y: 112, rot: 5, band: ACC },
  ];
  return (
    <g>
      {cards.map((c, i) => (
        <g key={i} transform={`rotate(${c.rot} ${c.x + 100} ${c.y + 60})`}>
          <rect x={c.x + 5} y={c.y + 7} width={200} height={124} rx={14} fill={DEEP} {...outline} />
          <rect x={c.x} y={c.y} width={200} height={124} rx={14} fill={CARD} {...outline} />
          <path d={`M${c.x} ${c.y + 34}V${c.y + 14}a14 14 0 0 1 14-14h172a14 14 0 0 1 14 14v20Z`} fill={c.band} {...outline} />
          <Shield cx={c.x + 32} cy={c.y + 72} r={15} fill={c.band} check={i === 2} />
          <Line x={c.x + 60} y={c.y + 60} w={100} fill={DEEP} h={8} />
          <Line x={c.x + 60} y={c.y + 78} w={70} h={7} />
          {i === 2 && <Tick x={c.x + 178} y={c.y + 102} r={11} />}
        </g>
      ))}
      <Sparkle x={380} y={96} r={9} />
      <Sparkle x={398} y={122} r={4.5} fill={WARM} />
      <Sparkle x={36} y={262} r={6} fill={MID} />

      <Link d="M330 214C372 222 392 250 400 282" />
      <Shot name="features/ins-list" x={196} y={318} w={430} ratio={1120 / 480} cssWidth={560} round={16} label />
    </g>
  );
}

/* ── agreements ────────────────────────────────────────────────────────── */

/* Your own template: the terms written once, filled in for each rental. */
function TemplateScene() {
  const chip = (x: number, y: number, w: number, label: string) => (
    <g>
      <rect x={x} y={y} width={w} height={24} rx={12} fill={SOFT} stroke={ACC} strokeWidth={1.8} strokeDasharray="4 3" />
      <text x={x + w / 2} y={y + 16} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={TEXT}>{label}</text>
    </g>
  );
  return (
    <g>
      <Page x={50} y={104} w={240} h={320}>
        <text x={74} y={146} fontSize={16} fontWeight={800} letterSpacing="-0.02em" fill={TEXT}>Rental agreement</text>
        <Line x={74} y={164} w={176} />
        <Line x={74} y={182} w={140} />
        {chip(74, 202, 118, "Customer name")}
        <Line x={74} y={240} w={176} />
        {chip(74, 258, 72, "Vehicle")}
        {chip(152, 258, 96, "Pickup date")}
        <Line x={74} y={296} w={160} />
        <Line x={74} y={314} w={120} />
        <path d="M74 392H250" stroke={INK} strokeWidth={1.6} strokeDasharray="4 4" />
        <text x={74} y={410} fontSize={10.5} fill={TEXT} opacity={0.7}>Signature</text>
      </Page>
      {/* The pen that writes it */}
      <g transform="rotate(38 268 214)" className="va-pop">
        <rect x={258} y={132} width={20} height={96} rx={6} fill={ACC} {...outline} />
        <rect x={258} y={132} width={20} height={20} rx={6} fill={DEEP} {...outline} />
        <path d="M258 228h20l-10 22Z" fill={WARM} {...outline} />
      </g>
      <Sparkle x={316} y={120} r={8} />
      <Sparkle x={334} y={144} r={4} fill={WARM} />

      <Link d="M298 300C318 300 330 290 340 282" />
      <Shot name="features/agr-templates" x={346} y={232} w={258} ratio={380 / 306} cssWidth={190} round={20} label />
    </g>
  );
}

/* Sent for e-signature, and signed on the renter's phone. */
function SignScene() {
  return (
    <g>
      <Phone x={52} y={30} w={174} h={304}>
        <text x={139} y={78} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={TEXT}>Sign your agreement</text>
        <Line x={78} y={96} w={120} fill={DEEP} h={8} />
        <Line x={78} y={114} w={104} h={7} />
        <Line x={78} y={130} w={118} h={7} />
        <Line x={78} y={146} w={90} h={7} />
        <rect x={74} y={172} width={130} height={70} rx={12} fill={SOFT} {...outline} />
        <path className="va-sign" pathLength={1} d="M86 220c8-20 13-22 16-10s6 12 12-3 10-6 14 2 7 6 13-4 12 2 18 4" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        <rect x={74} y={262} width={130} height={34} rx={17} fill={ACC} {...outline} />
        <text x={139} y={284} textAnchor="middle" fontSize={13} fontWeight={700} fill={ON}>Sign</text>
      </Phone>
      {/* Sent from the portal */}
      <g className="va-fly">
        <path d="M276 92l96-36-34 92-18-34Z" fill={CARD} {...outline} />
        <path d="M276 92l44 22 52-58" fill={MID} {...outline} />
        <path d="M320 114v34" {...outline} />
      </g>
      <path d="M232 132c18-8 30-18 40-30" stroke={ACC} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="1 7" />
      <Sparkle x={400} y={70} r={8} />
      <Sparkle x={418} y={96} r={4} fill={WARM} />

      <Link d="M230 248C290 256 318 290 330 326" />
      <Shot name="features/agr-sent" x={214} y={358} w={420} ratio={960 / 376} cssWidth={480} label />
    </g>
  );
}

/* The signed copy, kept on the rental. */
function KeptScene() {
  return (
    <g>
      <rect x={40} y={150} width={226} height={230} rx={16} fill={WARM} {...outline} />
      <path d="M40 166a16 16 0 0 1 16-16h66l16 18" fill={WARM} {...outline} />
      <g className="va-fly">
        <rect x={68} y={80} width={172} height={210} rx={10} fill={CARD} {...outline} />
        <Line x={88} y={104} w={100} fill={DEEP} h={8} />
        <Line x={88} y={122} w={126} h={7} />
        <Line x={88} y={138} w={110} h={7} />
        <Line x={88} y={154} w={120} h={7} />
        <path d="M90 222c8-16 12-18 15-8s5 10 10-2 9-5 12 2 6 5 11-3" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M88 238H190" stroke={INK} strokeWidth={1.4} />
      </g>
      <path d="M40 232h226v132a16 16 0 0 1-16 16H56a16 16 0 0 1-16-16Z" fill={ACC} {...outline} />
      <text x={64} y={270} fontSize={15} fontWeight={800} letterSpacing="-0.01em" fill={ON}>Rental RNT-2049</text>
      <text x={64} y={290} fontSize={11.5} fill={ON} opacity={0.85}>Signed copy kept here</text>
      <g className="va-pop">
        <circle cx={222} cy={326} r={30} fill={DEEP} {...outline} />
        <circle cx={222} cy={326} r={23} stroke={ON} strokeOpacity={0.55} strokeDasharray="3 4" />
        <path d="m211 326 8 8 15-16" stroke={ON} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <Sparkle x={292} y={110} r={8} />
      <Sparkle x={310} y={134} r={4} fill={WARM} />

      <Link d="M268 196C294 196 310 200 320 210" />
      <Shot name="features/agr-terms" x={274} y={226} w={350} ratio={960 / 760} cssWidth={480} label />
    </g>
  );
}

/* ── payments ──────────────────────────────────────────────────────────── */

/* Paid by card, into your own Stripe or Square. */
function OwnAccountScene() {
  return (
    <g>
      <PayCard x={26} y={86} w={140} rot={-12} className="va-fly" />
      <path d="M176 104a16 16 0 0 1 0 22M184 96a28 28 0 0 1 0 38" stroke={ACC} strokeWidth={2.4} strokeLinecap="round" />
      {/* The terminal */}
      <rect x={198} y={36} width={98} height={182} rx={18} fill={DEEP} {...outline} />
      <rect x={208} y={48} width={78} height={76} rx={10} fill={CARD} {...outline} />
      <Tick x={247} y={76} r={13} className="va-pop" />
      <text x={247} y={112} textAnchor="middle" fontSize={11} fontWeight={700} fill={TEXT}>Paid</text>
      {[0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => (
        <rect key={`${row}${col}`} x={212 + col * 24} y={136 + row * 22} width={20} height={16} rx={4} fill={ON} fillOpacity={0.26} />
      )))}
      {/* Into your own account */}
      <path d="M220 228c-20 18-46 26-74 28" stroke={ACC} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="1 7" />
      <path d="M44 262l50-28 50 28Z" fill={ACC} {...outline} />
      <circle cx={94} cy={252} r={5} fill={WARM} {...outline} />
      <rect x={44} y={262} width={100} height={9} rx={2} fill={CARD} {...outline} />
      {[54, 84, 114].map((x) => (
        <rect key={x} x={x} y={271} width={20} height={36} fill={SOFT} {...outline} />
      ))}
      <rect x={38} y={307} width={112} height={12} rx={3} fill={CARD} {...outline} />
      <text x={94} y={342} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={TEXT}>Your own account</text>
      <Sparkle x={326} y={56} r={8} />
      <Sparkle x={344} y={80} r={4} fill={WARM} />

      <Link d="M300 200C340 220 362 262 372 312" />
      <Shot name="features/pay-charges" x={214} y={342} w={420} ratio={960 / 400} cssWidth={480} label />
    </g>
  );
}

/* A deposit held on the renter's card, not taken. */
function DepositScene() {
  return (
    <g>
      <PayCard x={44} y={80} w={230} rot={-6} />
      {/* The hold */}
      <g className="va-pop">
        <path d="M268 170v-22a26 26 0 0 1 52 0v22" stroke={INK} strokeWidth={9} strokeLinecap="round" />
        <path d="M268 170v-22a26 26 0 0 1 52 0v22" stroke={MID} strokeWidth={5} strokeLinecap="round" />
        <rect x={250} y={166} width={88} height={74} rx={14} fill={DEEP} {...outline} />
        <circle cx={294} cy={196} r={9} fill={WARM} />
        <path d="M294 202v16" stroke={WARM} strokeWidth={6} strokeLinecap="round" />
      </g>
      <g transform="rotate(-8 120 268)">
        <path d="M70 250h108l16 18-16 18H70a8 8 0 0 1-8-8v-20a8 8 0 0 1 8-8Z" fill={WARM} {...outline} />
        <circle cx={182} cy={268} r={4} fill={CARD} {...outline} />
        <text x={118} y={273} textAnchor="middle" fontSize={13} fontWeight={800} letterSpacing="-0.01em" fill={ON_PALE}>Held, not taken</text>
      </g>
      <Sparkle x={366} y={88} r={8} />
      <Sparkle x={384} y={112} r={4} fill={WARM} />
      <Sparkle x={34} y={58} r={6} fill={MID} />

      <Link d="M340 216C372 240 388 290 392 330" />
      <Shot name="features/pay-deposit" x={214} y={362} w={420} ratio={960 / 328} cssWidth={480} label />
    </g>
  );
}

/* What you kept: takings, less refunds, tax, deposits and costs. */
function KeptMoneyScene() {
  return (
    <g>
      {/* The jar */}
      <path d="M62 156h116v18c22 8 26 30 26 58v74a24 24 0 0 1-24 24H60a24 24 0 0 1-24-24v-74c0-28 4-50 26-58Z" fill={CARD} {...outline} />
      <rect x={56} y={138} width={128} height={22} rx={8} fill={DEEP} {...outline} />
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx={120} cy={312 - i * 18} rx={58} ry={11} fill={i % 2 ? WARM : ACC} {...outline} />
      ))}
      <text x={120} y={232} textAnchor="middle" fontSize={15} fontWeight={800} letterSpacing="-0.02em" fill={TEXT}>Kept</text>
      <g className="va-coin">
        <ellipse cx={120} cy={104} rx={22} ry={22} fill={WARM} {...outline} />
        <text x={120} y={110} textAnchor="middle" fontSize={17} fontWeight={800} fill={ON_PALE}>$</text>
      </g>
      {/* And it grows */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} className="va-rise" style={{ animationDelay: `${300 + i * 120}ms` }} x={232 + i * 28} y={190 - i * 26} width={20} height={44 + i * 26} rx={5} fill={i === 3 ? ACC : MID} {...outline} />
      ))}
      <path d="M232 142l30-16 28 6 40-34" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m318 92 14-2-2 14" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={366} y={70} r={8} />
      <Sparkle x={384} y={94} r={4} fill={WARM} />

      <Link d="M212 300C236 296 244 282 250 270" />
      <Shot name="features/pay-kept" x={230} y={256} w={400} ratio={1966 / 1164} cssWidth={980} round={14} label />
    </g>
  );
}

const SCENES: Record<ArtTone, { label: string; scenes: (() => ReactNode)[] }> = {
  insurance: {
    label: "Insurance: cover added at checkout through Bonzah, a renter's own policy uploaded and read, and every policy in one list in the portal.",
    scenes: [CoverScene, UploadScene, ListScene],
  },
  agreements: {
    label: "Agreements: your own template, sent for e-signature and signed on the renter's phone, and the signed copy kept on the rental.",
    scenes: [TemplateScene, SignScene, KeptScene],
  },
  payments: {
    label: "Payments: a card paid into your own Stripe or Square account, a deposit held on the renter's card, and Insights showing what you kept.",
    scenes: [OwnAccountScene, DepositScene, KeptMoneyScene],
  },
};

export function FeatureArt({ tone, active, step }: { tone: ArtTone; active: boolean; step?: number }) {
  const uid = `fa${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { ref, visible } = useReveal();
  const [auto, setAuto] = useState(0);
  const { label, scenes } = SCENES[tone];

  // Off the held screen it plays through by itself, while it is in view.
  useEffect(() => {
    if (step !== undefined || !visible || !active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let at = 0;
    setAuto(0);
    const timer = window.setInterval(() => {
      at = (at + 1) % scenes.length;
      setAuto(at);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [step, visible, active, scenes.length]);

  const now = Math.min(scenes.length - 1, step ?? auto);

  return (
    <div ref={ref} className="va" data-scene={now}>
      <svg viewBox={`0 0 ${W} ${H}`} fill="none" role="img" aria-label={label}>
        <Uid.Provider value={uid}>
          {scenes.map((Scene, i) => (
            // Re-mounted each time it comes on, so its own motion plays again.
            <g key={i === now ? `${i}-on` : i} className={`va-scene${i === now ? " is-on" : ""}`}>
              <Scene />
            </g>
          ))}
        </Uid.Provider>
      </svg>
    </div>
  );
}
