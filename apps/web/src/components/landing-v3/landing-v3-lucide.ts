import { LANDING_V3_ICONS, type IconNode } from "./landing-v3-icons";

/*
 * A stand-in for lucide's UMD build (`window.lucide`), which the design loads
 * from a CDN. The design scripts use exactly two things from it:
 *   - lucide.icons[PascalName]  → the icon's [tag, attrs][] nodes
 *   - lucide.createIcons()      → replace every <i data-lucide="name"> with its SVG
 * Both are served here from LANDING_V3_ICONS (generated from lucide-react).
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const BASE: Record<string, string> = {
  xmlns: SVG_NS,
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

const pascal = (kebab: string) => kebab.replace(/(^|-)(\w)/g, (_, _a, c: string) => c.toUpperCase());

function toSvg(name: string, nodes: IconNode, from: Element): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const k in BASE) svg.setAttribute(k, BASE[k]);
  for (const a of Array.from(from.attributes)) if (a.name !== "class") svg.setAttribute(a.name, a.value);
  svg.setAttribute("class", `lucide lucide-${name} ${from.getAttribute("class") || ""}`.trim());
  for (const [tag, attrs] of nodes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    svg.appendChild(el);
  }
  return svg;
}

export function installLucideShim(): void {
  const w = window as unknown as { lucide?: unknown };
  w.lucide = {
    icons: LANDING_V3_ICONS,
    createIcons() {
      document.querySelectorAll("i[data-lucide]").forEach((el) => {
        const name = el.getAttribute("data-lucide") || "";
        const nodes = LANDING_V3_ICONS[pascal(name)];
        if (nodes) el.replaceWith(toSvg(name, nodes, el));
      });
    },
  };
}
