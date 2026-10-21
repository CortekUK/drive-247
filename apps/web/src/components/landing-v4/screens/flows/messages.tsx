import {
  Bot,
  Calendar,
  Car,
  Check,
  CheckCheck,
  Circle,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Send,
  User,
  X,
} from "lucide-react";
import { FlowPhone, PortalHeader } from "./chrome";
import type { Flow } from "./types";
import "./messages.css";

/* ===================================================================== *
 * Renter flow "Message you" — the ORIGINAL customer portal's live chat and
 * the Trax assistant, at a 390px phone (no sm:/md: classes apply).
 *
 * Mirrored (apps/booking/src):
 *   - app/(legacy)/(customer-portal)/portal/messages/page.tsx:6-23 — the
 *     MessageSquare h-5 + h1 "Messages" (text-xl font-bold), "Chat with our
 *     support team" (text-sm mt-1, mb-4), the window box
 *     h-[calc(100dvh-200px)] min-h-[400px].
 *   - app/(legacy)/(customer-portal)/layout.tsx:118-141 — CustomerPortalHeader,
 *     <main p-4>, and <TraxChatWidget /> on every portal page.
 *   - components/customer-portal/chat/CustomerChatWindow.tsx:73-157 — header
 *     "Chat with {company_name}" with "typing..." / Online / Last seen;
 *     DateSeparator per day; TypingIndicator "{tenant} is typing..." while
 *     the operator types; CustomerChatInput at the bottom.
 *   - chat/CustomerChatMessage.tsx:28-185 — bubbles (own: bg-primary,
 *     rounded-br-md, h:mm a + Check / CheckCheck once read, User avatar h-7;
 *     operator: bg-muted, rounded-bl-md, the sender line is the COMPANY name,
 *     not the staff member's), DateSeparator ("Today" / "MMMM d, yyyy").
 *   - chat/CustomerChatInput.tsx:110-165 — the attached-booking chip
 *     ("{make model} - {rentalNumber}" + X), Paperclip BookingPicker (ghost
 *     icon 44px, "Attach booking"), Textarea "Type a message..." (min-h 44,
 *     rows 1), Send (44px). A message sent with a booking carries
 *     metadata.type 'booking_reference'.
 *   - chat/BookingPicker.tsx:55-100 — rentalNumber is `RNT-` + the first six
 *     characters of the rental id, upper-cased (so R-3fa0d2 → RNT-3FA0D2);
 *     status is rentals.status as stored ("Pending").
 *   - chat/BookingReferenceCard.tsx:42-115 — the card inside the bubble:
 *     Car tile, name + outline status badge (own-message colours), rental
 *     number · plate, Calendar "MMM d - MMM d, yyyy".
 *   - trax-chat/TraxChatWidget.tsx — the FAB shows only while the popup is
 *     closed; TraxChatButton.tsx — fixed bottom-6 right-6 h-14 w-14
 *     rounded-full bg-primary, MessageCircle h-6.
 *   - trax-chat/TraxChatPopup.tsx:25-105 — fixed inset-x-3 bottom-3 rounded-xl
 *     border, primary header Bot + "Trax Assistant" + X, tabs "Trax" | "Chat"
 *     (Trax active by default).
 *   - trax-chat/TraxAIChatWindow.tsx:25-50 + TraxAIChatInput.tsx — the welcome
 *     and "Ask Trax anything...".
 *
 * Assumptions / honest limits:
 *   - The "Try asking:" lines are plain <p className="italic"> — not buttons —
 *     so nothing is tapped in the popup and no AI answer is drawn. The tap is
 *     on the FAB that opens it.
 *   - The FAB really is fixed over the page on /portal/messages; at this size
 *     it covers the bottom ~11px of the chat's Send button. Drawn as is.
 *   - ScrollArea scrolls to the newest message (messagesEndRef), so once the
 *     thread overflows it is drawn bottom-anchored with older lines clipped.
 *   - The earlier Oct 18 exchange and all message text are demo data. The
 *     operator's reply shows "Northwind Rentals" as sender — the code shows
 *     the company name, never the staff member (so no "Maya" here).
 *   - Presence ("Online") needs the operator's portal open; assumed it is.
 *   - Times ("h:mm a") are set just before the status bar's 10:00.
 * ===================================================================== */

const TENANT = "Northwind Rentals";
const QUESTION = "Hi! Can I pick up the Sonata an hour early on Nov 7?";
const REPLY = "Hi Daniel, yes — 9am works. See you on the 7th!";

function Pill({ children }: { children: string }) {
  return (
    <div className="fm-sep">
      <span>{children}</span>
    </div>
  );
}

function Own({ text, time, read, booking, late }: { text: string; time: string; read?: boolean; booking?: boolean; late?: boolean }) {
  return (
    <div className={`fm-row own${late ? " fl-late" : ""}`}>
      <div className="fm-bub own">
        <p className="fm-txt">{text}</p>
        {booking ? (
          <span className="fm-ref">
            <span className="fm-ref-ic">
              <Car />
            </span>
            <span className="fm-ref-b">
              <span className="fm-ref-t">
                <span className="fm-ref-nm">Hyundai Sonata</span>
                <span className="fm-ref-badge">Pending</span>
              </span>
              <span className="fm-ref-m">
                <span>RNT-3FA0D2</span>
                <span className="dot">·</span>
                <span>9LMV284</span>
              </span>
              <span className="fm-ref-d">
                <Calendar />
                <span>Nov 7 - Nov 10, 2026</span>
              </span>
            </span>
          </span>
        ) : null}
        <div className="fm-meta">
          <span>{time}</span>
          {read ? <CheckCheck /> : <Check />}
        </div>
      </div>
      <span className="fm-me">
        <User />
      </span>
    </div>
  );
}

function Theirs({ text, time, late }: { text: string; time: string; late?: boolean }) {
  return (
    <div className={`fm-row${late ? " fl-late" : ""}`}>
      <div className="fm-bub op">
        <p className="fm-from">{TENANT}</p>
        <p className="fm-txt">{text}</p>
        <div className="fm-meta">
          <span>{time}</span>
        </div>
      </div>
    </div>
  );
}

/** The Messages page; `stage` 0 composing, 1 sent + typing, 2 replied. */
function MessagesPage({ stage, animate }: { stage: 0 | 1 | 2; animate: boolean }) {
  return (
    <main className="fl-main fm-main">
      <div className="fm-head">
        <div className="fm-h1">
          <MessageSquare />
          <h1>Messages</h1>
        </div>
        <p>Chat with our support team</p>
      </div>

      <div className="fm-win">
        <div className="fm-whd">
          <MessageSquare />
          <div className="fm-whd-b">
            <h2>Chat with {TENANT}</h2>
            <div className="fm-pres">
              {stage === 1 ? (
                <span className="fm-typing">typing...</span>
              ) : (
                <>
                  <Circle className="fm-dot" />
                  <span>Online</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={`fm-list${stage > 0 ? " end" : ""}`}>
          <Pill>October 18, 2026</Pill>
          <Own text="Just picked up the Camry — thanks!" time="11:04 AM" read />
          <Theirs text="Enjoy the drive, Daniel!" time="11:06 AM" />
          {stage > 0 ? (
            <>
              <Pill>Today</Pill>
              <Own text={QUESTION} time="9:57 AM" read={stage === 2} booking />
            </>
          ) : null}
          {stage === 1 ? (
            <div className={`fm-typ${animate ? " fl-late" : ""}`}>
              <div className="fm-typ-b">
                <span />
                <span />
                <span />
              </div>
              <span className="fm-typ-n">{TENANT} is typing...</span>
            </div>
          ) : null}
          {stage === 2 ? <Theirs text={REPLY} time="9:59 AM" late={animate} /> : null}
        </div>

        <div className="fm-in">
          {stage === 0 ? (
            <div className="fm-chip-w">
              <span className="fm-chip">
                <Car />
                <span className="nm">Hyundai Sonata</span>
                <span className="mf">-</span>
                <span className="mf">RNT-3FA0D2</span>
                <span className="x">
                  <X />
                </span>
              </span>
            </div>
          ) : null}
          <div className="fm-in-r">
            <span className="fm-ib">
              <Paperclip />
            </span>
            <div className={`fm-ta${stage === 0 ? "" : " ph"}`}>
              <span>{stage === 0 ? QUESTION : "Type a message..."}</span>
            </div>
            <span className={`fm-send${stage === 0 ? " fl-tap" : " off"}`}>
              <Send />
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

function Screen({ step }: { step: number }) {
  const trax = step >= 3;
  const stage = (trax ? 2 : Math.min(step, 2)) as 0 | 1 | 2;
  return (
    <FlowPhone step={step} className="fm">
      <PortalHeader />
      <MessagesPage stage={stage} animate={!trax} />

      {/* TraxChatButton — visible while the popup is closed */}
      <span className={`fm-fab${trax ? " go" : ""}`}>
        <MessageCircle />
      </span>

      {trax ? (
        <div className="fm-pop">
          <div className="fm-pop-hd">
            <span className="t">
              <Bot />
              <h2>Trax Assistant</h2>
            </span>
            <span className="x">
              <X />
            </span>
          </div>
          <div className="fm-tabs">
            <span className="fm-tab on">
              <Bot />
              Trax
            </span>
            <span className="fm-tab">
              <MessageSquare />
              Chat
            </span>
          </div>
          <div className="fm-ai">
            <div className="fm-wel">
              <span className="fm-bot">
                <Bot />
              </span>
              <h3>Hi! I&apos;m Trax</h3>
              <p className="d">Your AI assistant for all things related to your rentals, payments, and bookings.</p>
              <div className="fm-try">
                <p>Try asking:</p>
                <p className="i">&quot;What&apos;s the status of my rental?&quot;</p>
                <p className="i">&quot;Show me my recent payments&quot;</p>
                <p className="i">&quot;When is my next payment due?&quot;</p>
              </div>
            </div>
          </div>
          <div className="fm-in-r fm-ai-in">
            <div className="fm-ta ph">
              <span>Ask Trax anything...</span>
            </div>
            <span className="fm-send off">
              <Send />
            </span>
          </div>
        </div>
      ) : null}
    </FlowPhone>
  );
}

export const FLOW_MESSAGES: Flow = {
  id: "messages",
  title: "Message you",
  blurb: "Live chat with your team, and an AI assistant",
  steps: [
    { caption: "They message your team from their account, with the booking attached.", ms: 3000 },
    { caption: "The message lands in your inbox, and they see when you're typing.", ms: 2800 },
    { caption: "Your reply shows up in their chat instantly — no phone tag.", ms: 3200 },
    { caption: "Trax, the built-in AI assistant, answers questions about their rentals and payments.", ms: 3400 },
  ],
  Screen,
};
