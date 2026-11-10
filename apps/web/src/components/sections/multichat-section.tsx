"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Mail, MessageCircle, MessageSquare, Phone, PhoneCall, Send, Sparkles, Users } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { BrowserChrome } from "./portal-glass";
import { CallRecordCard, type CallRecordData } from "./mc-call-record";
import { TrackLabel } from "./track-label";
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
  | { kind: "call"; minutes: number; summary: string; at: string; record?: CallRecordData };

type Convo = {
  id: string;
  name: string;
  phone: string;
  email: string;
  usual: Channel;
  rental: { car: string; dates: string; status: string };
  /** The renter at a glance, for the panel beside the chat. */
  profile?: { since: string; rentals: number; spent: string; checks: [string, boolean][]; past: [string, string][]; note?: string };
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
    profile: {
      since: "Mar 2025",
      rentals: 4,
      spent: "$2,310",
      checks: [["ID verified", true], ["Agreement signed", true], ["Deposit held", true]],
      past: [["Toyota RAV4", "Sep 2 – 6"], ["Kia Telluride", "Jul 18 – 21"]],
      note: "Prefers early pickups. Travels with a child seat.",
    },
    unread: 2,
    thread: [
      { kind: "msg", from: "them", ch: "in_app", text: "Hi! Is the Telluride ready for Friday?", at: "Thu 9:02 AM" },
      { kind: "msg", from: "you", ch: "in_app", text: "It is. I've just sent your agreement to sign.", at: "Thu 9:05 AM" },
      { kind: "msg", from: "you", ch: "email", subject: "Your agreement for Nov 14 – 18", text: "Here's your rental agreement to sign before pickup. It takes a minute on your phone.", at: "Thu 9:06 AM" },
      {
        kind: "call",
        minutes: 2,
        summary: "Priya confirmed a 10:00 AM pickup and asked to add a child seat.",
        at: "Thu 2:40 PM",
        record: {
          summary: "Priya confirmed a 10:00 AM pickup on Friday and asked for a child seat for her son. I added the seat to the booking and told her the lockbox code comes by text that morning.",
          checkpoints: ["Pickup Fri 10:00 AM confirmed", "Child seat added", "Lockbox code by text"],
          actions: ["Add a child seat to the booking", "Fit the seat before pickup", "Text Priya the lockbox code Fri 8 AM"],
          lines: [
            { who: "you", at: 0, text: "Hi Priya, calling about Friday. Is 10:00 still good for pickup?" },
            { who: "them", at: 6, text: "Yes, 10 is perfect. Could I add a child seat? My son's coming." },
            { who: "you", at: 13, text: "Of course. I've added one, and it'll be fitted before you arrive." },
            { who: "them", at: 21, text: "Great. How do I get the keys?" },
            { who: "you", at: 25, text: "They're in the lockbox by the door. The code comes by text that morning." },
            { who: "them", at: 33, text: "Perfect, thank you!" },
          ],
        },
      },
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
    profile: { since: "Oct 2025", rentals: 1, spent: "$0", checks: [["ID verified", true], ["Agreement signed", true], ["Deposit held", false]], past: [], note: "First rental. Asked about charging." },
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
    profile: { since: "Jan 2025", rentals: 6, spent: "$1,980", checks: [["ID verified", true], ["Agreement signed", true], ["Deposit held", true]], past: [["Hyundai Sonata", "Oct 1 – 4"], ["Honda Civic", "Aug 9 – 12"]] },
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
    profile: { since: "Nov 2025", rentals: 0, spent: "$0", checks: [["ID verified", false], ["Agreement signed", false], ["Deposit held", false]], past: [], note: "Family trip, needs seven seats." },
    thread: [
      {
        kind: "call",
        minutes: 3,
        summary: "Daniel wants a minivan or a 7-seater for a family trip. He asked for a quote.",
        at: "Yesterday",
        record: {
          summary: "Daniel needs seven seats for a family trip, Nov 20 to 27, and asked for a quote. The Ford Explorer is free those dates. I said I'd send the quote today.",
          checkpoints: ["7 seats needed", "Nov 20 – 27", "Explorer is free"],
          actions: ["Send Daniel a quote for the Explorer", "Hold the Explorer for 24 hours", "Follow up tomorrow if he hasn't booked"],
          lines: [
            { who: "them", at: 0, text: "Hi, I need something with seven seats for a family trip." },
            { who: "you", at: 5, text: "Happy to help. Which dates are you thinking?" },
            { who: "them", at: 9, text: "The 20th to the 27th of November." },
            { who: "you", at: 14, text: "The Ford Explorer seats seven and it's free then. I'll send you a quote today." },
            { who: "them", at: 22, text: "Great, I'll look out for it." },
          ],
        },
      },
    ],
    reply: {
      chat: "Here's your quote for the Explorer, 7 seats, Nov 20 – 27: $714 all in.",
      subject: "Your quote for Nov 20 – 27",
      email: "Hi Daniel, here's your quote for the Ford Explorer, 7 seats, Nov 20 – 27: $714 all in.",
      call: "Walked Daniel through the quote. He'll book tonight.",
    },
  },
  ...(
    [
      ["noah", "Noah Bennett", "sms", "Toyota RAV4", "Nov 9 – 11", "On rent", "On my way back, 20 min out.", "Mon"],
      ["sophia", "Sophia Martinez", "email", "Ford Mustang", "Nov 16 – 19", "Confirmed", "Can I add a second driver?", "Mon"],
      ["james", "James Carter", "sms", "Jeep Wrangler", "Nov 20 – 22", "Awaiting payment", "Paying tonight, thanks!", "Sun"],
      ["chloe", "Chloe Adams", "in_app", "Toyota RAV4", "Nov 9 – 12", "On rent", "Is there a phone mount in the car?", "Sun"],
      ["owen", "Owen Price", "email", "Ford Mustang", "Nov 13 – 14", "Confirmed", "Thanks for the quick reply.", "Sat"],
      ["mia", "Mia Chen", "in_app", "Kia Telluride", "Nov 13 – 18", "Booked", "See you Friday!", "Sat"],
    ] as const
  ).map(
    ([id, name, ch, car, dates, status, text, at]): Convo => ({
      id,
      name,
      phone: "(555) 010-0100",
      email: `${id}@example.com`,
      usual: ch,
      rental: { car, dates, status },
      thread: [{ kind: "msg", from: "them", ch, text, at }],
      reply: {
        chat: `Thanks ${name.split(" ")[0]}, all noted. Anything else, just message me here.`,
        subject: `Your ${car}`,
        email: `Hi ${name.split(" ")[0]}, all noted for your ${car}. Anything else, just reply to this email.`,
        call: `Caught up with ${name.split(" ")[0]} about the ${car}.`,
      },
    }),
  ),
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
                <div className="mc-rail-list">
                {/* Bulk messages: one message to many renters, each landing in their own thread. */}
                <div className="mc-broadcast">
                  <span className="mc-avatar is-group">
                    <Users aria-hidden />
                  </span>
                  <span className="mc-row-text">
                    <span className="mc-row-top">
                      <b>Everyone out this weekend</b>
                      <small>Fri</small>
                    </span>
                    <span className="mc-row-last">
                      <span>Sent to 12 renters · 11 read</span>
                    </span>
                  </span>
                  <TrackLabel n={1} way="down">
                    One message to many renters
                  </TrackLabel>
                </div>
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
                </div>
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
                    item.kind === "call" && item.record ? (
                      <li key={i} className="mc-call-record">
                        <CallRecordCard record={item.record} name={open.name} at={item.at} minutes={item.minutes} labels />
                      </li>
                    ) : item.kind === "call" ? (
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
                    <TrackLabel n={4} way="right">
                      Pick the channel for each reply
                    </TrackLabel>
                  </div>

                  {mode === "call" ? (
                    <div className="mc-callbox">
                      <span>
                        <b>{open.phone}</b>
                        <small>Recorded, with a summary from Trax when you hang up.</small>
                      </span>
                      <button type="button" className="mc-send" disabled={!fresh} onClick={send}>
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
                              <TrackLabel n={5} way="right">
                                Trax drafts the reply
                              </TrackLabel>
                            </span>
                            {mode === "email" ? open.reply.email : open.reply.chat}
                          </>
                        ) : (
                          `Sent by ${VIA[mode] === "In-app" ? "in-app chat" : VIA[mode]}. Try another channel.`
                        )}
                      </p>
                      <button type="button" className="mc-send" disabled={!fresh} onClick={send}>
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
                  <span>
                    <b>{open.rental.car}</b>
                    <small>
                      <CalendarDays aria-hidden />
                      {open.rental.dates}
                    </small>
                  </span>
                  <em>{open.rental.status}</em>
                  <TrackLabel n={6} way="down">
                    Their booking, alongside
                  </TrackLabel>
                </div>
                {open.profile && (
                  <>
                    <dl className="mc-stats">
                      <div>
                        <dt>Renter since</dt>
                        <dd>{open.profile.since}</dd>
                      </div>
                      <div>
                        <dt>Rentals</dt>
                        <dd>{open.profile.rentals}</dd>
                      </div>
                      <div>
                        <dt>Spent</dt>
                        <dd>{open.profile.spent}</dd>
                      </div>
                    </dl>
                    <ul className="mc-checks">
                      {open.profile.checks.map(([label, ok]) => (
                        <li key={label} className={ok ? "is-ok" : ""}>
                          <i aria-hidden />
                          {label}
                        </li>
                      ))}
                    </ul>
                    {open.profile.past.length > 0 && (
                      <>
                        <p className="mc-who-title">Past rentals</p>
                        <ul className="mc-past">
                          {open.profile.past.map(([car, dates]) => (
                            <li key={car + dates}>
                              <b>{car}</b>
                              <small>{dates}</small>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {open.profile.note && (
                      <>
                        <p className="mc-who-title">Note</p>
                        <p className="mc-note">{open.profile.note}</p>
                      </>
                    )}
                  </>
                )}
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
