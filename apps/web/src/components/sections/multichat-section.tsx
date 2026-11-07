"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Car, Mail, MessageCircle, MessageSquare, Phone, PhoneCall, Send, Sparkles, Users } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { BrowserChrome } from "./portal-glass";
import "./multichat-section.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Multi-chat: the portal's Messages screen (apps/portal/src/components/messages-v2), one
 * conversation per renter with every channel in it. Checked against that code:
 * - four channels from one composer: In-App, SMS, Email (with a subject) and Call
 *   (conversation-view.tsx MODES). WhatsApp is not one of them, so it is not here;
 * - Trax suggests a reply in the empty composer (trax-ghost-reply.tsx);
 * - a call leaves a record in the thread with Trax's summary (call-record.tsx);
 * - one message to many renters at once (bulk-select.tsx);
 * - the renter and their rentals beside the thread (customer-context.tsx).
 * The visitor picks a channel and sends Trax's reply. People and messages are demo content.
 */

type Channel = "in_app" | "sms" | "email" | "call";

const CHANNELS: { key: Channel; label: string; icon: typeof Mail }[] = [
  { key: "in_app", label: "In-App", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
  { key: "call", label: "Call", icon: Phone },
];
const VIA: Record<Channel, string> = { in_app: "In-app", sms: "SMS", email: "Email", call: "Call" };

type Item =
  | { kind: "msg"; from: "them" | "you"; ch: Exclude<Channel, "call">; text: string; subject?: string; at: string }
  | { kind: "call"; minutes: number; summary: string; at: string };

type Convo = {
  id: string;
  name: string;
  phone: string;
  email: string;
  usual: Channel;
  rental: { car: string; dates: string; status: string };
  unread?: number;
  thread: Item[];
  /** What Trax would say next, on each channel. */
  reply: { chat: string; subject: string; email: string; call: string };
};

const CONVOS: Convo[] = [
  {
    id: "priya",
    name: "Priya Shah",
    phone: "(555) 014-2290",
    email: "priya@example.com",
    usual: "sms",
    rental: { car: "Kia Telluride", dates: "Nov 14 – 18", status: "Confirmed" },
    unread: 2,
    thread: [
      { kind: "msg", from: "them", ch: "in_app", text: "Hi! Is the Telluride ready for Friday?", at: "Thu 9:02 AM" },
      { kind: "msg", from: "you", ch: "in_app", text: "It is. I've just sent your agreement to sign.", at: "Thu 9:05 AM" },
      { kind: "msg", from: "you", ch: "email", subject: "Your agreement for Nov 14 – 18", text: "Here's your rental agreement to sign before pickup. It takes a minute on your phone.", at: "Thu 9:06 AM" },
      { kind: "call", minutes: 2, summary: "Priya confirmed a 10:00 AM pickup and asked to add a child seat.", at: "Thu 2:40 PM" },
      { kind: "msg", from: "them", ch: "sms", text: "Can I pick up an hour early?", at: "9:14 AM" },
    ],
    reply: {
      chat: "Yes, 9:00 works. The car will be ready, and your lockbox code comes by text that morning.",
      subject: "Your pickup is now 9:00 AM",
      email: "Hi Priya, your pickup is now at 9:00 AM on Friday. Your lockbox code arrives by text that morning.",
      call: "Confirmed the 9:00 AM pickup and the child seat.",
    },
  },
  {
    id: "marcus",
    name: "Marcus Hill",
    phone: "(555) 018-4412",
    email: "marcus@example.com",
    usual: "email",
    rental: { car: "Tesla Model 3", dates: "Nov 20 – 27", status: "Confirmed" },
    thread: [
      { kind: "msg", from: "you", ch: "email", subject: "Your Tesla booking", text: "You're booked for Nov 20 – 27. Your agreement is attached to sign.", at: "Tue 4:10 PM" },
      { kind: "msg", from: "them", ch: "email", subject: "Re: Your Tesla booking", text: "Thanks, the agreement's signed. Is charging included?", at: "8:51 AM" },
    ],
    reply: {
      chat: "It comes fully charged, and any Supercharging on your trip is matched to your rental.",
      subject: "Re: Your Tesla booking",
      email: "Hi Marcus, the car comes fully charged, and any Supercharging on your trip is matched to your rental.",
      call: "Explained charging and confirmed the Nov 20 pickup.",
    },
  },
  {
    id: "elena",
    name: "Elena Rossi",
    phone: "(555) 011-7730",
    email: "elena@example.com",
    usual: "in_app",
    rental: { car: "Hyundai Sonata", dates: "Nov 6 – 9", status: "On rent" },
    thread: [{ kind: "msg", from: "them", ch: "in_app", text: "Where do I leave the keys on Sunday?", at: "Yesterday" }],
    reply: {
      chat: "Back in the lockbox by the front door, using the same code. Thanks Elena!",
      subject: "Returning your Sonata",
      email: "Hi Elena, please leave the keys in the lockbox by the front door, using the same code.",
      call: "Talked Elena through the lockbox return.",
    },
  },
  {
    id: "daniel",
    name: "Daniel Kim",
    phone: "(555) 016-9921",
    email: "daniel@example.com",
    usual: "call",
    rental: { car: "Ford Explorer", dates: "Nov 20 – 27", status: "Quoted" },
    thread: [{ kind: "call", minutes: 3, summary: "Daniel wants a minivan or a 7-seater for a family trip. He asked for a quote.", at: "Yesterday" }],
    reply: {
      chat: "Here's your quote for the Explorer, 7 seats, Nov 20 – 27: $714 all in.",
      subject: "Your quote for Nov 20 – 27",
      email: "Hi Daniel, here's your quote for the Ford Explorer, 7 seats, Nov 20 – 27: $714 all in.",
      call: "Walked Daniel through the quote. He'll book tonight.",
    },
  },
];

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("");

const FEATURES = [
  { icon: MessageSquare, title: "Choose the channel", text: "In-app, SMS, email or a call, from the same box. Each renter's usual channel is picked for you." },
  { icon: MessageCircle, title: "One history per renter", text: "Every text, email and call with a renter sits in one thread, with their bookings beside it." },
  { icon: Sparkles, title: "Trax drafts the reply", text: "Trax suggests an answer to the latest message, written for the channel you picked. Press Tab to use it." },
  { icon: Users, title: "Message many at once", text: "Send the same message to everyone you pick, each landing in their own thread." },
];

export function MultichatSection() {
  const { ref, visible } = useFadeIn();
  const [openId, setOpenId] = useState("priya");
  const [mode, setMode] = useState<Channel>("sms");
  // What the visitor has sent, per conversation, on top of the scripted history.
  const [sent, setSent] = useState<Record<string, Item[]>>({});
  const [read, setRead] = useState<Record<string, boolean>>({ priya: true });

  const threadEl = useRef<HTMLOListElement>(null);
  const open = CONVOS.find((c) => c.id === openId)!;
  const thread = [...open.thread, ...(sent[open.id] ?? [])];
  const usedOn = new Set((sent[open.id] ?? []).map((i) => (i.kind === "call" ? "call" : i.ch)));
  const fresh = !usedOn.has(mode);

  // The newest message in view, as in the real thread: it scrolls inside, the page doesn't move.
  useEffect(() => {
    const el = threadEl.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [thread.length, openId]);

  const pick = (id: string) => {
    const c = CONVOS.find((x) => x.id === id)!;
    setOpenId(id);
    setMode(c.usual);
    setRead((r) => ({ ...r, [id]: true }));
  };

  const send = () => {
    if (!fresh) return;
    const item: Item =
      mode === "call"
        ? { kind: "call", minutes: 1, summary: open.reply.call, at: "Just now" }
        : mode === "email"
          ? { kind: "msg", from: "you", ch: "email", subject: open.reply.subject, text: open.reply.email, at: "Just now" }
          : { kind: "msg", from: "you", ch: mode, text: open.reply.chat, at: "Just now" };
    setSent((s) => ({ ...s, [open.id]: [...(s[open.id] ?? []), item] }));
  };

  return (
    <section id="multichat" aria-labelledby="multichat-heading" className="mc-section">
      <div ref={ref} className={`mc-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="mc-head">
          <SectionHeading
            id="multichat-heading"
            title={
              <>
                Multi-chat: every channel, <Accent>one conversation</Accent>
              </>
            }
            sub={
              <>
                Talk to renters by in-app chat, SMS, email or phone, from one screen. Pick the channel for each message, and see the whole history with every renter in one thread.
              </>
            }
          />
        </div>

        <p className="mc-tip">Pick a channel under the conversation, then send Trax&apos;s reply.</p>

        <div className="mc-window">
          <BrowserChrome tab="Messages · Your portal" url="northwind.portal.drive-247.com/messages">
            <div className="mc-app">
              {/* Conversations */}
              <aside className="mc-rail" aria-label="Conversations">
                <p className="mc-rail-title">Messages</p>
                <ul>
                  {CONVOS.map((c) => {
                    const last = [...c.thread, ...(sent[c.id] ?? [])].slice(-1)[0];
                    const lastText = last.kind === "call" ? `Call · ${last.minutes} min` : last.text;
                    const lastCh: Channel = last.kind === "call" ? "call" : last.ch;
                    const Icon = CHANNELS.find((x) => x.key === lastCh)!.icon;
                    return (
                      <li key={c.id}>
                        <button type="button" className={`mc-row${c.id === open.id ? " is-open" : ""}`} aria-pressed={c.id === open.id} onClick={() => pick(c.id)}>
                          <span className="mc-avatar">{initials(c.name)}</span>
                          <span className="mc-row-text">
                            <span className="mc-row-top">
                              <b>{c.name}</b>
                              <small>{last.at === "Just now" ? "now" : last.at.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /, "")}</small>
                            </span>
                            <span className="mc-row-last">
                              <Icon aria-hidden />
                              <span>{lastText}</span>
                            </span>
                          </span>
                          {c.unread && !read[c.id] ? <i className="mc-unread">{c.unread}</i> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>

              {/* The conversation */}
              <div className="mc-convo">
                <header className="mc-convo-head">
                  <span className="mc-avatar">{initials(open.name)}</span>
                  <span>
                    <b>{open.name}</b>
                    <small>Usually replies by {VIA[open.usual] === "Call" ? "phone" : VIA[open.usual]}</small>
                  </span>
                </header>

                <ol key={open.id} ref={threadEl} className="mc-thread">
                  {thread.map((item, i) =>
                    item.kind === "call" ? (
                      <li key={i} className="mc-call">
                        <span className="mc-call-top">
                          <PhoneCall aria-hidden />
                          <b>Call · {item.minutes} min</b>
                          <small>{item.at}</small>
                        </span>
                        <span className="mc-call-sum">
                          <Sparkles aria-hidden />
                          {item.summary}
                        </span>
                      </li>
                    ) : (
                      <li key={i} className={`mc-msg is-${item.from}`}>
                        <span className="mc-bubble">
                          {item.subject && <b className="mc-subject">{item.subject}</b>}
                          {item.text}
                        </span>
                        <small>
                          {VIA[item.ch]} · {item.at}
                        </small>
                      </li>
                    ),
                  )}
                </ol>

                {/* The composer: the channel first, then what goes out on it. */}
                <div className="mc-composer">
                  <div className="mc-switch" role="radiogroup" aria-label="Send by">
                    {CHANNELS.map((c) => (
                      <button key={c.key} type="button" role="radio" aria-checked={mode === c.key} onClick={() => setMode(c.key)}>
                        <c.icon aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {mode === "call" ? (
                    <div className="mc-callbox">
                      <span>
                        <b>{open.phone}</b>
                        <small>Recorded, with a summary from Trax when you hang up.</small>
                      </span>
                      <button type="button" className={`mc-send${fresh ? " mc-hint" : ""}`} disabled={!fresh} onClick={send}>
                        <PhoneCall aria-hidden />
                        {fresh ? `Call ${open.name.split(" ")[0]}` : "Called"}
                      </button>
                    </div>
                  ) : (
                    <div className="mc-box">
                      {mode === "email" && (
                        <span className="mc-email-to">
                          <small>To</small> {open.email}
                          <small>Subject</small> {fresh ? open.reply.subject : ""}
                        </span>
                      )}
                      <p className={`mc-draft${fresh ? "" : " is-empty"}`}>
                        {fresh ? (
                          <>
                            <span className="mc-trax">
                              <Sparkles aria-hidden />
                              Trax suggests
                            </span>
                            {mode === "email" ? open.reply.email : open.reply.chat}
                          </>
                        ) : (
                          `Sent by ${VIA[mode] === "In-app" ? "in-app chat" : VIA[mode]}. Try another channel.`
                        )}
                      </p>
                      <button type="button" className={`mc-send${fresh ? " mc-hint" : ""}`} disabled={!fresh} onClick={send}>
                        <Send aria-hidden />
                        Send {VIA[mode] === "In-app" ? "" : `by ${VIA[mode]}`}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Who you're talking to */}
              <aside className="mc-who" aria-label={`About ${open.name}`}>
                <span className="mc-avatar is-big">{initials(open.name)}</span>
                <b>{open.name}</b>
                <dl>
                  <div>
                    <dt>
                      <Phone aria-hidden />
                      Phone
                    </dt>
                    <dd>{open.phone}</dd>
                  </div>
                  <div>
                    <dt>
                      <Mail aria-hidden />
                      Email
                    </dt>
                    <dd>{open.email}</dd>
                  </div>
                </dl>
                <p className="mc-who-title">Rental</p>
                <div className="mc-rental">
                  <Car aria-hidden />
                  <span>
                    <b>{open.rental.car}</b>
                    <small>
                      <CalendarDays aria-hidden />
                      {open.rental.dates}
                    </small>
                  </span>
                  <em>{open.rental.status}</em>
                </div>
              </aside>
            </div>
          </BrowserChrome>
        </div>

        <ul className="mc-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <f.icon aria-hidden />
              <b>{f.title}</b>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
