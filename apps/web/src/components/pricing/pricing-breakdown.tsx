"use client";

import type { CSSProperties } from "react";

import {
  BadgePercent,
  Check,
  CircleSlash,
  ReceiptText,
  Users,
} from "lucide-react";
import type { SignupPlan, SignupPlanId } from "@/lib/plans";
import type { EnterpriseCard as EnterpriseCardData } from "@/lib/enterprise-card-server";
import type { PromoOffer } from "@/lib/promo-offer";
import { EnterpriseCard } from "./enterprise-card";
import { PlanCard } from "./plan-card";
import "./pricing-breakdown.css";

/*
 * Under the plan cards: everything a plan includes, what costs extra and who it is paid to,
 * and what a whole month really costs. Answers "$129–$349 with no breakdown looks expensive":
 * nothing about the bill is left for the operator to find out later.
 *
 * MOCK (Ghulam, 2026-11-07: "even if you have to mock something, do mock it for now"):
 * the add-on prices below are placeholders in the shape of the monthly add-on proposal
 * (memory: project_agreement_credits_economics). Today's live prices are credits, $1 each
 * in the smallest pack: 7 per e-signed agreement, 2 per text, 31 per licence check.
 * Set the real figures before this goes live. Card fees are Stripe's published US rate.
 */

type Cell = "yes" | "usage" | "renter";

/*
 * Where the plans do differ, it is in support, and the plans say so in their own bullets
 * (signup_plans, edited by a super admin). These rows read those bullets, so the table and
 * the cards above it can never disagree.
 */
const has = (p: SignupPlan, words: string) => p.bullets.some((b) => b.toLowerCase().includes(words));
const onboarding = (p: SignupPlan) => (has(p, "onboarding") ? "30 minutes, free" : "Included");
const support = (p: SignupPlan) => (has(p, "priority") ? "Priority" : "Standard");
const slack = (p: SignupPlan) => {
  const line = p.bullets.find((b) => b.toLowerCase().includes("slack"));
  if (!line) return "Not offered";
  if (line.toLowerCase().includes("included")) return "Included";
  const price = line.match(/\$\d+/)?.[0];
  return price ? `${price} a month` : "Available";
};

const GROUPS: { title: string; rows: { name: string; cell?: Cell; value?: (p: SignupPlan) => string }[] }[] = [
  {
    title: "Your booking website",
    rows: [
      { name: "A booking website in your own brand" },
      { name: "Online booking, checkout and payment" },
      { name: "Your own domain" },
      { name: "Fleet, promotions, reviews and contact pages" },
    ],
  },
  {
    title: "Rentals and fleet",
    rows: [
      { name: "Rentals, extensions and returns" },
      { name: "Availability calendar" },
      { name: "Fleet records and maintenance" },
      { name: "Fines and tolls" },
      { name: "Key handover and lockbox codes" },
    ],
  },
  {
    title: "Renters",
    rows: [
      { name: "Customer records and history" },
      { name: "A portal for every renter" },
      { name: "ID and licence checks", cell: "usage" },
      { name: "E-signed rental agreements", cell: "usage" },
      { name: "Insurance with Bonzah", cell: "renter" },
    ],
  },
  {
    title: "Payments",
    rows: [
      { name: "Stripe or Square, paid into your own account" },
      { name: "Deposits and holds" },
      { name: "Invoices and receipts" },
      { name: "0% commission on every booking" },
    ],
  },
  {
    title: "Messages",
    rows: [
      { name: "Texts and WhatsApp with renters", cell: "usage" },
      { name: "Booking emails and reminders" },
    ],
  },
  {
    title: "Your numbers",
    rows: [
      { name: "Insights and finances" },
      { name: "Xero and Zoho sync" },
      { name: "Trax, built in" },
    ],
  },
  {
    title: "Team and support",
    rows: [
      { name: "Unlimited staff logins with roles" },
      { name: "Unlimited bookings and customers" },
      { name: "Onboarding session", value: onboarding },
      { name: "Support from inside your portal", value: support },
      { name: "Your own Slack channel with us", value: slack },
    ],
  },
];

const PROMISES = [
  { icon: BadgePercent, text: "0% commission on bookings" },
  { icon: CircleSlash, text: "No setup fee" },
  { icon: ReceiptText, text: "No contract. Cancel anytime" },
  { icon: Users, text: "Unlimited staff and bookings" },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const TONES = ["lilac", "brand", "deep"] as const;

/* What Enterprise has where the plans differ, read from its own card where it says. */
const enterpriseValue = (row: string, card: EnterpriseCardData) => {
  const said = (w: string) => card.bullets.some((b) => b.toLowerCase().includes(w));
  if (row === "Onboarding session") return said("onboarding") ? "Assisted, with data migration" : "Included";
  if (row === "Support from inside your portal") return said("named") ? "Named contact" : "Dedicated";
  if (row === "Your own Slack channel with us") return said("slack") ? "Included" : "On request";
  return null;
};

/*
 * The plans and the comparison, as one: each plan's card heads its own column, and the
 * rows below say what is in it. Enterprise, when it is switched on, is the last column.
 */
export function PricingBreakdown({
  plans,
  enterprise = null,
  offer = null,
  onSelect,
  showTrial = true,
}: {
  plans: readonly SignupPlan[];
  enterprise?: EnterpriseCardData | null;
  offer?: PromoOffer | null;
  onSelect?(planId: SignupPlanId): void;
  showTrial?: boolean;
}) {
  const cols = plans.length + (enterprise ? 1 : 0);
  return (
    <div className="pb">
      <div className="pb-table-wrap">
        <table className="pb-table pb-merged" style={{ "--pb-cols": cols } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col" className="pb-corner">
                <b>Everything in every plan</b>
                <span>The whole platform on all of them. The difference is the size of fleet each is priced for.</span>
              </th>
              {plans.map((p, i) => (
                <th key={p.id} scope="col">
                  <PlanCard plan={p} onSelect={onSelect} offer={offer} tone={TONES[Math.min(i, TONES.length - 1)]} showTrial={showTrial} compact />
                </th>
              ))}
              {enterprise && (
                <th scope="col">
                  <EnterpriseCard card={enterprise} compact />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <tr className="pb-key">
              <th scope="row">Sized for</th>
              {plans.map((p) => (
                <td key={p.id}>{p.fleetBand}</td>
              ))}
              {enterprise && <td>{enterprise.fleetBand ?? "51+ vehicles"}</td>}
            </tr>
            <tr className="pb-key">
              <th scope="row">At a full fleet, per car</th>
              {plans.map((p) => (
                <td key={p.id}>{money(p.priceUsd / p.maxVehicles)} a month</td>
              ))}
              {enterprise && <td>Custom</td>}
            </tr>
            {plans.some((p) => (p.trialDays ?? 0) > 0) && (
              <tr className="pb-key">
                <th scope="row">Free trial</th>
                {plans.map((p) => (
                  <td key={p.id}>{p.trialDays ? `${p.trialDays} days` : "None"}</td>
                ))}
                {enterprise && <td>Talk to us</td>}
              </tr>
            )}
            {GROUPS.map((group) => (
              <Group key={group.title} group={group} plans={plans} enterprise={enterprise} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="pb-legend">
        <span>
          <Check aria-hidden /> Included
        </span>
        <span>
          <i className="pb-chip">Add-on</i> Priced by use
        </span>
        <span>
          <i className="pb-chip is-renter">Renter pays</i> Charged to your renter at checkout
        </span>
      </p>

      <ul className="pb-promises">
        {PROMISES.map((p) => (
          <li key={p.text}>
            <p.icon aria-hidden />
            {p.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Group({ group, plans, enterprise }: { group: (typeof GROUPS)[number]; plans: readonly SignupPlan[]; enterprise: EnterpriseCardData | null }) {
  return (
    <>
      <tr className="pb-group">
        <th scope="rowgroup" colSpan={plans.length + 1 + (enterprise ? 1 : 0)}>
          {group.title}
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.name}>
          <th scope="row">{row.name}</th>
          {plans.map((p) => (
            <td key={p.id} className={row.value ? "pb-val" : undefined}>
              {row.value ? (
                row.value(p)
              ) : row.cell === "usage" ? (
                <i className="pb-chip">Add-on</i>
              ) : row.cell === "renter" ? (
                <i className="pb-chip is-renter">Renter pays</i>
              ) : (
                <Check aria-label="Included" />
              )}
            </td>
          ))}
          {enterprise && (
            <td className={enterpriseValue(row.name, enterprise) ? "pb-val" : undefined}>
              {enterpriseValue(row.name, enterprise) ?? (row.cell === "renter" ? <i className="pb-chip is-renter">Renter pays</i> : <Check aria-label="Included" />)}
            </td>
          )}
        </tr>
      ))}
    </>
  );
}
