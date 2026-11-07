import type { Block } from "@/content/types";
import "./content.css";

/** Renders an article from the plain blocks in src/content. */
export function ArticleBody({ body }: { body: readonly Block[] }) {
  return (
    <div className="ct-prose">
      {body.map((block, index) => {
        switch (block.type) {
          case "p":
            return <p key={index}>{block.text}</p>;
          case "h2":
            return <h2 key={index}>{block.text}</h2>;
          case "list":
            return (
              <ul key={index}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={index} className="ct-steps">
                {block.items.map((step, n) => (
                  <li key={step.title}>
                    <span className="ct-step-n" aria-hidden>
                      {n + 1}
                    </span>
                    <div>
                      <p className="ct-step-title">{step.title}</p>
                      <p className="ct-step-text">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <figure key={index} className="ct-quote">
                <blockquote>
                  <p>{block.text}</p>
                </blockquote>
                {block.by && <figcaption>{block.by}</figcaption>}
              </figure>
            );
          case "callout":
            return (
              <aside key={index} className="ct-callout">
                <strong>{block.title}</strong>
                <p>{block.text}</p>
              </aside>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
