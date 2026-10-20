"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
 * Screens are laid out at a fixed design size (like a real 1280 × 800 portal
 * window) and scaled to whatever width the frame gets, so a mock-up reads the
 * same on a phone as on a 27" monitor instead of reflowing into something the
 * product never looks like.
 */
export function Scaled({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={ref} className="l4-scaled" style={{ aspectRatio: `${width} / ${height}` }}>
      <div
        className="inner"
        style={{ width, height, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}

export function Laptop({ children, width = 1280, height = 800 }: { children: ReactNode; width?: number; height?: number }) {
  return (
    <div className="l4-laptop">
      <div className="lid">
        <div className="screen">
          <Scaled width={width} height={height}>
            {children}
          </Scaled>
        </div>
      </div>
      <div className="base" />
    </div>
  );
}

export function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="l4-phone">
      <div className="screen">
        <span className="notch" />
        <Scaled width={390} height={820}>
          {children}
        </Scaled>
      </div>
    </div>
  );
}
