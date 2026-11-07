"use client";

import {
  BarChart3,
  CalendarCheck,
  CreditCard,
  FileSignature,
  Globe,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  Calculator,
  ScanFace,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./end-to-end-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * The whole business, end to end: five stages from the first ad a renter sees to the money
 * in the operator's account, and the part of Drive247 that does each one. This is a real
 * sequence, so it is numbered. Marketing and lead management are not built yet and say so.
 */

type Tool = { icon: typeof Globe; name: string; soon?: boolean };

const STAGES: { title: string; text: string; tools: Tool[] }[] = [
  {
    title: "Get found",
    text: "Bring renters to your own site, not to a marketplace.",
    tools: [
      { icon: Megaphone, name: "Meta and Google Ads", soon: true },
      { icon: Globe, name: "Your own booking website" },
    ],
  },
  {
    title: "Win the booking",
    text: "Answer every enquiry and let renters book and pay online.",
    tools: [
      { icon: Inbox, name: "Lead management", soon: true },
      { icon: CalendarCheck, name: "Online booking and checkout" },
      { icon: CreditCard, name: "Payments and deposits with Stripe or Square" },
    ],
  },
  {
    title: "Get them road-ready",
    text: "Checks, paperwork and cover, done before pickup.",
    tools: [
      { icon: ScanFace, name: "ID and licence checks" },
      { icon: FileSignature, name: "E-signed rental agreements" },
      { icon: ShieldCheck, name: "Insurance with Bonzah" },
    ],
  },
  {
    title: "Run the rental",
    text: "Every car, rental and renter, day to day.",
    tools: [
      { icon: LayoutDashboard, name: "Rentals, fleet and maintenance" },
      { icon: KeyRound, name: "Key handover and lockbox codes" },
      { icon: MessageSquareText, name: "Multi-chat: in-app, SMS, email and calls" },
      { icon: UserRound, name: "A portal for your renters" },
    ],
  },
  {
    title: "Know your numbers",
    text: "See what you earn, what you're owed, and what to do next.",
    tools: [
      { icon: BarChart3, name: "Insights and finances" },
      { icon: Calculator, name: "Xero and Zoho sync" },
      { icon: Sparkles, name: "Trax, built in" },
    ],
  },
];

export function EndToEndSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="end-to-end" aria-labelledby="end-to-end-heading" className="ee-section">
      <div ref={ref} className={`ee-inner${visible ? " is-in" : ""}`}>
        <div className="ee-head">
          <SectionHeading
            id="end-to-end-heading"
            title={
              <>
                Your whole rental business, <Accent>end to end</Accent>
              </>
            }
            sub={
              <>
                From the first ad a renter sees to the money in your account, every step runs on Drive247.
              </>
            }
          />
        </div>

        <ol className="ee-stages">
          {STAGES.map((stage, i) => (
            <li key={stage.title} className="ee-stage" style={{ "--ee-i": i } as CSSProperties}>
              <span className="ee-no" aria-hidden>
                {i + 1}
              </span>
              <div className="ee-card">
                <h3>{stage.title}</h3>
                <p>{stage.text}</p>
                <ul>
                  {stage.tools.map((tool) => (
                    <li key={tool.name}>
                      <tool.icon aria-hidden />
                      <span>
                        {tool.name}
                        {tool.soon && <small>Coming soon</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>

        <p className="ee-close">
          One portal for you. One website and portal for your renters. One set of records behind it all.
        </p>
      </div>
    </section>
  );
}
