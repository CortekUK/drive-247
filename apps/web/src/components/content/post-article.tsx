import type { ReactNode } from "react";
import Image from "next/image";
import { Check, X } from "lucide-react";

import type { Block } from "@/content/types";
import "./post-article.css";

/* `**bold**` and `*cursive*` inside a block's text. */
export function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*")) return <em key={index} className="ar-cursive">{part.slice(1, -1)}</em>;
    return part;
  });
}

const NUMBER = new Intl.NumberFormat("en-US");

/**
 * A blog article's body. Unlike a single column of text, each block picks its own width:
 * reading text stays narrow, statements and charts run wide, and a band crosses the page.
 */
export function PostArticle({ body }: { body: readonly Block[] }) {
  return (
    <div className="ar-body">
      {body.map((block, index) => {
        switch (block.type) {
          case "p":
            return <p key={index} className="ar-text ar-p">{rich(block.text)}</p>;
          case "h2":
            return <h2 key={index} className="ar-wide ar-h2">{rich(block.text)}</h2>;
          case "big":
            return <p key={index} className="ar-wide ar-big">{rich(block.text)}</p>;
          case "list":
            return (
              <ul key={index} className="ar-text ar-list">
                {block.items.map((item) => (
                  <li key={item}>{rich(item)}</li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={index} className="ar-wide ar-steps">
                {block.items.map((step, n) => (
                  <li key={step.title}>
                    <span className="ar-step-n" aria-hidden>{n + 1}</span>
                    <p className="ar-step-title">{step.title}</p>
                    <p className="ar-step-text">{step.text}</p>
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <figure key={index} className="ar-wide ar-quote">
                <blockquote>
                  <p>{rich(block.text)}</p>
                </blockquote>
                {block.by && <figcaption>{block.by}</figcaption>}
              </figure>
            );
          case "callout":
            return (
              <aside key={index} className="ar-wide ar-callout">
                <p className="ar-callout-title ar-cursive">{block.title}</p>
                <p className="ar-callout-text">{rich(block.text)}</p>
              </aside>
            );
          case "band":
            return (
              <section key={index} className="ar-band">
                <div className="ar-band-in">
                  <p className="ar-band-text">{rich(block.text)}</p>
                  {block.sub && <p className="ar-band-sub">{rich(block.sub)}</p>}
                </div>
              </section>
            );
          case "stats":
            return (
              <ul key={index} className="ar-wide ar-stats">
                {block.items.map((item) => (
                  <li key={item.label}>
                    <span className="ar-stat-value">{item.value}</span>
                    <span className="ar-stat-label">{item.label}</span>
                  </li>
                ))}
              </ul>
            );
          case "bars": {
            const max = Math.max(...block.bars.map((bar) => bar.value));
            return (
              <figure key={index} className="ar-wide ar-chart">
                <figcaption>
                  <p className="ar-chart-title">{block.title}</p>
                  {block.note && <p className="ar-chart-note">{block.note}</p>}
                </figcaption>
                <ul className="ar-bars">
                  {block.bars.map((bar) => (
                    <li key={bar.label} data-strong={bar.strong ? "" : undefined}>
                      <span className="ar-bar-label">{bar.label}</span>
                      <span className="ar-bar-track">
                        <span className="ar-bar-fill" style={{ width: `${(bar.value / max) * 100}%` }} />
                        <span className="ar-bar-value">
                          {block.prefix}
                          {NUMBER.format(bar.value)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </figure>
            );
          }
          case "compare":
            return (
              <div key={index} className="ar-wide ar-compare">
                <div className="ar-side-col">
                  <p className="ar-compare-title">{block.left.title}</p>
                  <ul>
                    {block.left.items.map((item) => (
                      <li key={item}>
                        <X strokeWidth={2.2} aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="ar-side-col" data-ours="">
                  <p className="ar-compare-title">{block.right.title}</p>
                  <ul>
                    {block.right.items.map((item) => (
                      <li key={item}>
                        <Check strokeWidth={2.4} aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          case "side":
            return (
              <figure key={index} className="ar-wide ar-side">
                <div className="ar-side-photo">
                  <Image src={block.src} alt={block.alt} fill sizes="(min-width: 900px) 560px, 100vw" />
                </div>
                <figcaption>
                  <p className="ar-side-title">{rich(block.title)}</p>
                  <p className="ar-side-text">{rich(block.text)}</p>
                </figcaption>
              </figure>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
