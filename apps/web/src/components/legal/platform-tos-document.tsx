/**
 * Renders the Appendix A platform Terms of Service from lib/legal/platform-tos.ts.
 *
 * The content lives in a data module rather than as JSX so that the version
 * constants, the integrity tests, and the rendered page all read from ONE
 * source. Without that, "flip the flag to ship it" silently changes what gets
 * recorded (tenants.platform_tos_version) without changing what tenants are
 * shown — recording consent to a document nobody has read.
 *
 * Server component (no "use client"): it is pure data → markup with no state,
 * so it stays in the marketing app's static-render path alongside the other
 * legal pages, which matters for SEO and for anything crawling the terms.
 */

import {
  PLATFORM_TOS_CLOSING,
  PLATFORM_TOS_EFFECTIVE_DATE,
  PLATFORM_TOS_LAST_UPDATED,
  PLATFORM_TOS_SECTIONS,
  PLATFORM_TOS_SUBTITLE,
  PLATFORM_TOS_TITLE,
  type TosBlock,
} from "@/lib/legal/platform-tos";

function Block({ block }: { block: TosBlock }) {
  switch (block.t) {
    case "caps":
      // Sections 29 and 30 are drafted in capitals deliberately — several US
      // states condition the enforceability of warranty disclaimers and
      // liability caps on their being conspicuous. The text is already
      // uppercase in the data rather than transformed in CSS, so a copy-paste
      // of the page carries the capitals too.
      return <p className="font-medium">{block.text}</p>;
    case "lead":
      return (
        <p>
          <strong>{block.lead}</strong> {block.text}
        </p>
      );
    case "def":
      return (
        <p>
          <strong className="uppercase tracking-wide">{block.term}</strong>{" "}
          {block.text}
        </p>
      );
    case "p":
      return <p>{block.text}</p>;
    default: {
      // Exhaustiveness guard. A new TosBlock variant that is not handled here
      // would otherwise render as an empty paragraph — a clause silently
      // missing from a contract, with no test failure (the tests assert section
      // counts, never rendered output).
      //
      // Caveat worth knowing: apps/web sets typescript.ignoreBuildErrors, so
      // `next build` will NOT fail on this never-assignment. It surfaces under
      // `npx tsc --noEmit` and in-editor only. Treat a red squiggle here as a
      // release blocker rather than assuming CI has your back.
      const _exhaustive: never = block;
      return null;
    }
  }
}

export function PlatformTosDocument() {
  return (
    <article className="prose prose-zinc mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1>{PLATFORM_TOS_TITLE}</h1>
      <p className="lead">{PLATFORM_TOS_SUBTITLE}</p>
      <p className="text-sm text-zinc-500">
        Effective: {PLATFORM_TOS_EFFECTIVE_DATE} · Last updated:{" "}
        {PLATFORM_TOS_LAST_UPDATED}
      </p>

      {PLATFORM_TOS_SECTIONS.map((section) => (
        <section key={section.n}>
          <h2>
            {section.n}. {section.title}
          </h2>
          {section.body.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </section>
      ))}

      <p className="text-center font-semibold">{PLATFORM_TOS_CLOSING}</p>
    </article>
  );
}
