-- Re-scope admin_todos from a global board to per-tenant boards.
-- Each tenant detail page now shows only its own cards.

-- Wipe the small set of existing test rows (only 1 row at time of migration).
-- Comments cascade via FK ON DELETE CASCADE.
DELETE FROM public.admin_todos;

ALTER TABLE public.admin_todos
  ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL
  REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Replace the old (status, position) index with a tenant-aware one.
DROP INDEX IF EXISTS public.idx_admin_todos_status_position;
CREATE INDEX IF NOT EXISTS idx_admin_todos_tenant_status_position
  ON public.admin_todos (tenant_id, status, position);

COMMENT ON COLUMN public.admin_todos.tenant_id IS
  'Per-tenant scoping. Cards are visible only on the matching tenant detail page.';
