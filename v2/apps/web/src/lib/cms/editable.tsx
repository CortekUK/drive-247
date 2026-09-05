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
 */
export function Editable({
  path,
  as: Tag = "span",
  className,
  children,
}: {
  path: string;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag data-cms={path} className={className}>
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
