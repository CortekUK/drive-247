import { ArrowRight } from "lucide-react";

import "@/components/content/content.css";
import "./book-demo-section.css";

/*
 * Book a demo: the page's soft close, right after detailed pricing, for the visitor who is
 * not sure yet (Ghulam, 2026-11-07). It only promises what the call already is: free,
 * 20 minutes, a member of the founding team, no obligation, and the three things the
 * /strategy-call page lists (a look at how they run today, a preview of their own site,
 * and a plan they keep). The button goes to that page; the page itself is not changed.
 */

const ON_THE_CALL = [
  {
    title: "A look at how you run today",
    text: "We go through how you take bookings, payments and agreements now, and where time or money is slipping away.",
  },
  {
    title: "Your own site, previewed",
    text: "See how your booking site could look with your name, your fleet and your booking flow.",
  },
  {
    title: "A plan you keep",
    text: "You leave with clear next steps and the right plan for your fleet, whether you sign or not.",
  },
];

export function BookDemoSection() {
  return (
    <section id="book-a-demo" className="dc" aria-labelledby="dc-title">
      <div className="ct-inner">
        <div className="dc-panel">
          <div className="dc-copy">
            <h2 id="dc-title" className="ct-title font-medium tracking-tighter">
              Not sure yet? <span className="ct-brand">Talk it through with us.</span>
            </h2>
            <p className="dc-sub">
              Book a free 20-minute call with our founding team. No sales script, and no obligation to sign.
            </p>
            <div className="dc-actions">
              <a href="/strategy-call" className="dc-btn">
                Book a demo
                <ArrowRight strokeWidth={2} aria-hidden />
              </a>
              <a href="#pricing" className="dc-alt">
                Or start your free trial
              </a>
            </div>
          </div>

          <div className="dc-call">
            <p className="dc-call-head">On the call</p>
            <ol className="dc-list">
              {ON_THE_CALL.map((item, i) => (
                <li key={item.title}>
                  <span className="dc-n" aria-hidden>
                    {i + 1}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="dc-facts">
              <span>Free</span>
              <span>20 minutes</span>
              <span>Founding team</span>
              <span>No obligation</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
