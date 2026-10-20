"use client";

import { useEffect } from "react";
import { runV3Sections } from "./v3-sections-behaviour";
import "./v3-sections.css";

/*
 * The sections v4 keeps exactly as the old page had them (Trax, testimonials,
 * FAQ, footer): the old markup, styles and scripts, unchanged.
 *
 * Each is mounted inside `.d3s > .d3-root`: `.d3s` is what the old stylesheet
 * is scoped to now (it was `html.d3p`, which would also have styled the new
 * sections around these), and `.d3-root` is where its browser-default reset
 * applies, as before.
 */
export function V3Section({ html }: { html: string }) {
  return (
    <div className="d3s">
      <div className="d3-root" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** Runs the old scripts once every restored section is in the document. */
export function V3SectionsBehaviour() {
  useEffect(() => runV3Sections(), []);
  return null;
}
