-- Admin Todos: Notion-style Kanban board for Drive247 super-admin staff.
-- Single global board (no tenant scoping) — all super admins share it.

CREATE TABLE IF NOT EXISTS public.admin_todos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,
  image_path    TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium',
  status        TEXT NOT NULL DEFAULT 'not_started',
  position      DOUBLE PRECISION NOT NULL DEFAULT 0,
  due_date      DATE,
  assignee_id   UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_todos_title_len_chk CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT admin_todos_description_len_chk CHECK (description IS NULL OR char_length(description) <= 5000),
  CONSTRAINT admin_todos_priority_chk CHECK (priority IN ('low','medium','high')),
  CONSTRAINT admin_todos_status_chk   CHECK (status IN ('not_started','in_progress','done'))
);

CREATE INDEX IF NOT EXISTS idx_admin_todos_status_position ON public.admin_todos (status, position);
CREATE INDEX IF NOT EXISTS idx_admin_todos_assignee       ON public.admin_todos (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_todos_due_date       ON public.admin_todos (due_date)    WHERE due_date    IS NOT NULL;

DROP TRIGGER IF EXISTS set_admin_todos_updated_at ON public.admin_todos;
CREATE TRIGGER set_admin_todos_updated_at
  BEFORE UPDATE ON public.admin_todos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.admin_todo_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id     UUID NOT NULL REFERENCES public.admin_todos(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_todo_comments_body_len_chk CHECK (char_length(body) BETWEEN 1 AND 5000)
);

CREATE INDEX IF NOT EXISTS idx_admin_todo_comments_todo
  ON public.admin_todo_comments (todo_id, created_at DESC);

ALTER TABLE public.admin_todos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_todo_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins read todos"   ON public.admin_todos;
DROP POLICY IF EXISTS "super admins insert todos" ON public.admin_todos;
DROP POLICY IF EXISTS "super admins update todos" ON public.admin_todos;
DROP POLICY IF EXISTS "super admins delete todos" ON public.admin_todos;

CREATE POLICY "super admins read todos"   ON public.admin_todos FOR SELECT  USING (is_super_admin());
CREATE POLICY "super admins insert todos" ON public.admin_todos FOR INSERT  WITH CHECK (is_super_admin());
CREATE POLICY "super admins update todos" ON public.admin_todos FOR UPDATE  USING (is_super_admin());
CREATE POLICY "super admins delete todos" ON public.admin_todos FOR DELETE  USING (is_super_admin());

DROP POLICY IF EXISTS "super admins read comments"      ON public.admin_todo_comments;
DROP POLICY IF EXISTS "super admins insert comment"     ON public.admin_todo_comments;
DROP POLICY IF EXISTS "super admins delete own comment" ON public.admin_todo_comments;

CREATE POLICY "super admins read comments" ON public.admin_todo_comments FOR SELECT
  USING (is_super_admin());

CREATE POLICY "super admins insert comment" ON public.admin_todo_comments FOR INSERT
  WITH CHECK (
    is_super_admin()
    AND author_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1)
  );

CREATE POLICY "super admins delete own comment" ON public.admin_todo_comments FOR DELETE
  USING (
    is_super_admin()
    AND author_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'admin_todos'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_todos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'admin_todo_comments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_todo_comments';
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('todo-images', 'todo-images', true, 5242880,
        ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "super admins upload todo images" ON storage.objects;
DROP POLICY IF EXISTS "anyone read todo images"        ON storage.objects;
DROP POLICY IF EXISTS "super admins delete todo images" ON storage.objects;

CREATE POLICY "super admins upload todo images" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'todo-images' AND is_super_admin());

CREATE POLICY "anyone read todo images" ON storage.objects FOR SELECT
  USING (bucket_id = 'todo-images');

CREATE POLICY "super admins delete todo images" ON storage.objects FOR DELETE
  USING (bucket_id = 'todo-images' AND is_super_admin());

COMMENT ON TABLE public.admin_todos IS
  'Notion-style Kanban cards for Drive247 super-admin staff. Single global board.';
