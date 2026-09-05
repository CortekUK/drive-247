-- Website Content v2: in-place editing needs somewhere to hold an edit that is
-- not yet on the site.
--
-- `cms_page_sections.content` IS the live content — apps/booking and v2/apps/web
-- both read it directly, filtered only on the owning page's status. There has
-- never been draft storage; v1's "Save as draft" merely flipped the PAGE to
-- draft, taking the whole page off the site until someone clicked Publish.
--
-- `draft_content` is the pending copy of ONE section. NULL means "no pending
-- edit"; the site keeps reading `content` and never looks here. The portal's
-- visual editor reads `coalesce(draft_content, content)`, and Publish copies
-- draft_content into content and clears it, inside one statement per page.
--
-- Additive per V2_PLAN §4: nullable, no default change, no constraint over
-- existing rows. `anon` already holds a table-level SELECT on this table (it
-- is not `tenants`, which has only column grants), so no extra GRANT is
-- needed for the anon-key readers to keep working.
ALTER TABLE public.cms_page_sections
  ADD COLUMN IF NOT EXISTS draft_content jsonb;

COMMENT ON COLUMN public.cms_page_sections.draft_content IS
  'Pending edit from the portal visual editor. NULL = nothing pending; the site reads `content` only. Publish moves this into `content` and clears it.';
