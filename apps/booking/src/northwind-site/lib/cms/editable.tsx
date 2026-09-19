import type { ElementType, ReactNode } from "react";

/**
 * Marks ONE piece of CMS-bound text so the portal's visual editor can find it.
 *
 * On the public site this is inert: it renders the same element it is asked
 * for, plus a `data-cms` attribute nobody reads. It carries no client
 * JavaScript and no styling, so wrapping a headline in it changes nothing a
 * visitor can see or a crawler can index.
 *
 * In edit mode — the site embedded in the portal with `?cms-edit=1` — the
 * overlay in `components/cms/edit-overlay.tsx` queries `[data-cms]`, makes
 * each one editable in place, and posts the new value back to the portal
 * keyed by this path. So the path IS the write address:
 *
 *   `home.home_hero.headline`            → cms page `home`, section
 *                                           `home_hero`, field `headline`
 *   `about.why_choose_us.items.2.title`  → third item's title in that list
 *   `contact.contact_info.phone.number`  → a nested field, as stored
 *
 * Two constraints keep this honest:
 *
 *   1. The element must contain ONLY the text of that field — no icon, no
 *      sibling copy — because its textContent is what gets written back.
 *   2. The path must name a real stored field, in the shape booking already
 *      parses. Nothing is flattened or renamed; the portal writes the same
 *      rows v1's forms write.
 *
 * `as` defaults to `span` so it can sit inside an `h1` or a `p` without
 * changing the block structure a stylesheet is keyed on.
 *
 * ── the `table:` prefix ───────────────────────────────────────────────────
 *
 * A handful of things on the page are rows in their own table rather than
 * fields in a section's JSON — the FAQ questions (`faqs`) and the customer
 * quotes (`testimonials`). Those carry `table:<table>.<row id>.<column>`, and
 * the portal writes them straight to the row. They have no `draft_content`
 * column to stage into, so such an edit is LIVE the moment it is made — the
 * same thing the portal's own FAQ and Reviews screens have always done. The
 * prefix is what tells the portal which of the two write paths to take, and it
 * is why a row id must never contain a dot.
 */
export function Editable({
  path,
  as: Tag = "span",
  className,
  placeholder,
  children,
}: {
  path: string;
  as?: ElementType;
  className?: string;
  /**
   * Shown, greyed, when the field is empty AND the page is in edit mode.
   *
   * Without it an operator cannot fill in a field that is blank: an empty node
   * collapses to nothing, so there is no target to click. See the `:empty`
   * rule in `globals.css`. Never rendered on the public site.
   */
  placeholder?: string;
  children: ReactNode;
}) {
  return (
    <Tag data-cms={path} data-cms-placeholder={placeholder} className={className}>
      {children}
    </Tag>
  );
}

/**
 * Attributes for a section's root element, so the editor's rail can list the
 * page's sections by name and scroll to them.
 *
 *   <section {...cmsSection("home.home_hero", "Hero")}>
 */
export function cmsSection(id: string, label: string) {
  return { "data-cms-section": id, "data-cms-label": label } as const;
}

/**
 * Attributes for an IMAGE whose source is a CMS field.
 *
 * Text is edited in place because the operator can type into it. An image
 * cannot be typed into, so the overlay instead draws a "Change image" handle
 * over anything carrying `data-cms-image` and posts the path to the portal,
 * which owns the media library and the write. Same split of trust as the text
 * path: the site marks, the portal writes.
 *
 * `value` is the RAW stored value, not the rendered `src`. `next/image`
 * rewrites the latter into `/_next/image?url=…`, which is not something the
 * portal could show back to the operator or compare against the library.
 *
 *   <Image {...cmsImage("home.home_hero.hero_image", hero.hero_image)} … />
 *
 * `next/image` forwards unknown props to the underlying `<img>`, so this works
 * on both `Image` and a plain `img`.
 */
export function cmsImage(path: string, value: string) {
  return { "data-cms-image": path, "data-cms-image-src": value } as const;
}
