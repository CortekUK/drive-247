/**
 * Playground layout — deliberately does nothing.
 *
 * The v2 theme is NOT applied here. `src/proxy.ts` pins `/playground/*` to the
 * `northwind` slug, so the ROOT layout puts `v2-theme` on <body> and the Manrope
 * font variable on <html>, exactly as it does for the real canary tenant.
 *
 * An earlier version of this file wrapped the sandbox in its own
 * `<div className="v2-theme">`. That looked right and was wrong: the v2 base
 * rules are keyed on `body.v2-theme`, so a wrapper div inherits the colour
 * tokens but silently misses the typeface, the 14px desktop base size and the
 * font smoothing — a theme that is 80% correct and impossible to spot as
 * anything but "the design feels slightly off".
 */
import { ForceLight } from "./_force-light";

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ForceLight />
      {children}
    </>
  );
}
