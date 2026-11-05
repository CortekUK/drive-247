"use client";

import { ArrowUpRight } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import "./cta-band.css";

export function CTABand() {
  const { ref, visible } = useFadeIn();

  return (
    <section className="cb-band">
      <div className="cb-photo" aria-hidden />
      <div className="cb-tint" aria-hidden />

      <div ref={ref} className={`cb-copy ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <p className="cb-kicker">Get started</p>
        <h2 className="cb-title">
          Let your rentals run <span>24/7</span>
        </h2>
        <p className="cb-sub">
          Book a free 20-minute call and see Drive247 run your bookings, payments, driver checks and keys.
        </p>
        <div className="cb-row">
          <a href="/strategy-call" className="cb-btn cb-primary">
            Book a demo
            <ArrowUpRight strokeWidth={2} aria-hidden />
          </a>
          <a href="#pricing" className="cb-btn cb-ghost">
            See pricing
          </a>
        </div>
      </div>
    </section>
  );
}
