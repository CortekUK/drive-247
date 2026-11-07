import { ArrowRight } from "lucide-react";
import "./content.css";

/** The closing call to action on the blog and customer story pages. */
export function ContentCta() {
  return (
    <section className="ct-cta" aria-labelledby="ct-cta-title">
      <h2 id="ct-cta-title" className="ct-cta-title font-medium tracking-tighter">
        Run your rental business <span className="ct-brand">on Drive247</span>
      </h2>
      <p className="ct-cta-sub">Start a free trial today, or book a demo and we&apos;ll show you around.</p>
      <div className="ct-cta-row">
        <a href="/#pricing" className="ct-btn ct-btn-primary">
          Start free trial
          <ArrowRight strokeWidth={2} aria-hidden />
        </a>
        <a href="/strategy-call" className="ct-btn ct-btn-ghost">
          Book a demo
        </a>
      </div>
    </section>
  );
}
