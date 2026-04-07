import DOMPurify from "dompurify";

/**
 * Sanitize HTML content for safe rendering via dangerouslySetInnerHTML.
 * Allows standard blog content (headings, paragraphs, lists, images, videos, links)
 * while stripping dangerous tags like <script>, <iframe> (except YouTube), event handlers, etc.
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof window === "undefined") return dirty;

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "strong", "b", "em", "i", "u", "s", "del",
      "ul", "ol", "li",
      "blockquote", "pre", "code",
      "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
      "div", "span",
      "figure", "figcaption",
      "iframe",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel",
      "src", "alt", "width", "height", "loading",
      "class", "style",
      "title",
      "frameborder", "allowfullscreen", "allow",
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    // Allow YouTube embeds
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder"],
  });
}
