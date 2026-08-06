"use client";

/**
 * Renders the Appendix A platform Terms of Service from
 * lib/legal/platform-tos.ts.
 *
 * The content lives in a data module rather than as JSX so that the version
 * constants, the placeholder-integrity test, and the rendered page all read
 * from ONE source. Before this existed the module was dead code and the
 * documented "flip PLATFORM_TOS_IS_DRAFT to ship it" step was a no-op — the
 * page kept serving the old hardcoded document while checkouts would have
 * started stamping the new version string, recording consent to a document no
 * tenant had been shown.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      // liability caps on their being conspicuous. Rendered as-is (the text is
      // already uppercase in the data) rather than via text-transform, so a
      // copy-paste of the page carries the capitals too.
      return (
        <p className="text-sm font-medium leading-relaxed text-foreground">
          {block.text}
        </p>
      );
    case "lead":
      return (
        <p className="text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">{block.lead}</strong>{" "}
          {block.text}
        </p>
      );
    case "def":
      return (
        <p className="text-sm text-muted-foreground">
          <strong className="font-semibold uppercase tracking-wide text-foreground">
            {block.term}
          </strong>{" "}
          {block.text}
        </p>
      );
    case "p":
      return <p className="text-sm text-muted-foreground">{block.text}</p>;
    default: {
      // Exhaustiveness guard. Adding a variant to TosBlock without handling it
      // here would otherwise render a clause as an empty <p> — a clause silently
      // missing from a contract, with no compile error (portal sets
      // ignoreBuildErrors) and no test failure (the tests assert section counts,
      // never rendered output). This makes tsc point at the omission instead.
      const _exhaustive: never = block;
      return null;
    }
  }
}

export function PlatformTosDocument() {
  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">
          {PLATFORM_TOS_TITLE}
        </CardTitle>
        <p className="text-sm text-muted-foreground text-center mt-2">
          {PLATFORM_TOS_SUBTITLE}
        </p>
        <p className="text-xs text-muted-foreground text-center mt-1">
          Effective: {PLATFORM_TOS_EFFECTIVE_DATE} · Last updated:{" "}
          {PLATFORM_TOS_LAST_UPDATED}
        </p>
      </CardHeader>

      <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">
        {PLATFORM_TOS_SECTIONS.map((section) => (
          <section key={section.n} className="space-y-2">
            <h2 className="text-lg font-semibold">
              {section.n}. {section.title}
            </h2>
            {section.body.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}

        <p className="pt-4 text-center text-sm font-semibold text-foreground">
          {PLATFORM_TOS_CLOSING}
        </p>
      </CardContent>
    </Card>
  );
}
