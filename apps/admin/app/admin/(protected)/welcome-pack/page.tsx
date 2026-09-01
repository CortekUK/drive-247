'use client';

/**
 * Welcome Pack editor — super admin only.
 *
 * Content is GLOBAL (one pack for every tenant), authored here and rendered in
 * apps/portal at /welcome. Mirrors the announcements editor, with two
 * deliberate differences:
 *
 *  - Bodies are MARKDOWN, not HTML. Announcements render authored HTML through
 *    dangerouslySetInnerHTML; this document is longer, edited more often and
 *    read by everyone, so it takes the format that cannot inject markup.
 *  - Unpublished rows stay visible HERE but never reach operators, so content
 *    can be staged before it goes out.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BookOpen, ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Plus, Trash2, Users,
} from 'lucide-react';

/* ------------------------------------------------------------------ types */

interface Group {
  id: string;
  key: string;
  title: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_published: boolean;
}

interface Section {
  id: string;
  group_id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  icon: string | null;
  required_flag: string | null;
  sort_order: number;
  is_published: boolean;
}

interface Faq {
  id: string;
  group_id: string | null;
  question: string;
  answer_md: string;
  required_flag: string | null;
  sort_order: number;
  is_published: boolean;
}

interface Settings {
  id: string;
  doc_title: string;
  doc_subtitle: string | null;
  intro_md: string | null;
  show_on_first_login: boolean;
  version: number;
}

interface Readership {
  app_user_id: string;
  email: string;
  name: string | null;
  role: string;
  company_name: string | null;
  sections_read: number;
  last_read_at: string | null;
  completed: boolean;
  completed_at: string | null;
}

/** Icon names the portal can render. Must match welcome-icon.tsx. */
const ICON_NAMES = [
  'ArrowRight', 'BadgeAlert', 'Ban', 'Banknote', 'BarChart3', 'Bell', 'BookOpen',
  'Briefcase', 'Calculator', 'CalendarDays', 'CalendarPlus', 'Car',
  'CircleDollarSign', 'ClipboardList', 'Clock', 'Compass', 'CreditCard', 'Crown',
  'FileCheck', 'FileSignature', 'FileText', 'FlaskConical', 'Gift', 'Globe',
  'GraduationCap', 'Hash', 'Heart', 'Inbox', 'LayoutDashboard', 'LifeBuoy',
  'ListChecks', 'Lock', 'MessageSquare', 'Palette', 'PenLine', 'Quote',
  'Receipt', 'Rocket', 'Route', 'ScanFace', 'ScrollText', 'Send', 'Shield',
  'ShieldCheck', 'Sparkles', 'Star', 'Timer', 'TrendingUp', 'Users', 'Wallet',
  'Workflow', 'Zap',
];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------- page */

export default function WelcomePackAdminPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [readership, setReadership] = useState<Readership[]>([]);

  const [editingSection, setEditingSection] = useState<Partial<Section> | null>(null);
  const [editingFaq, setEditingFaq] = useState<Partial<Faq> | null>(null);
  const [editingGroup, setEditingGroup] = useState<Partial<Group> | null>(null);

  const load = async () => {
    setLoading(true);
    const [g, s, f, st, r] = await Promise.all([
      supabase.from('welcome_pack_groups').select('*').order('sort_order'),
      supabase.from('welcome_pack_sections').select('*').order('sort_order'),
      supabase.from('welcome_pack_faqs').select('*').order('sort_order'),
      supabase.from('welcome_pack_settings').select('*').maybeSingle(),
      supabase.from('v_welcome_pack_readership').select('*').order('sections_read', { ascending: false }),
    ]);
    if (g.error) toast.error(`Chapters: ${g.error.message}`);
    setGroups((g.data ?? []) as Group[]);
    setSections((s.data ?? []) as Section[]);
    setFaqs((f.data ?? []) as Faq[]);
    setSettings((st.data ?? null) as Settings | null);
    setReadership((r.data ?? []) as Readership[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const groupName = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, g.title])),
    [groups]
  );

  /* --------------------------------------------------------------- writes */

  const saveSection = async () => {
    if (!editingSection?.title || !editingSection.group_id) {
      toast.error('Chapter and title are required');
      return;
    }
    const payload = {
      group_id: editingSection.group_id,
      slug: editingSection.slug || slugify(editingSection.title),
      title: editingSection.title,
      summary: editingSection.summary || null,
      body_md: editingSection.body_md || '',
      icon: editingSection.icon || null,
      required_flag: editingSection.required_flag || null,
      sort_order: editingSection.sort_order ?? 0,
      is_published: editingSection.is_published ?? true,
    };
    const { error } = editingSection.id
      ? await supabase.from('welcome_pack_sections').update(payload).eq('id', editingSection.id)
      : await supabase.from('welcome_pack_sections').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('Page saved');
    setEditingSection(null);
    void load();
  };

  const saveFaq = async () => {
    if (!editingFaq?.question) return toast.error('Question is required');
    const payload = {
      group_id: editingFaq.group_id || null,
      question: editingFaq.question,
      answer_md: editingFaq.answer_md || '',
      required_flag: editingFaq.required_flag || null,
      sort_order: editingFaq.sort_order ?? 0,
      is_published: editingFaq.is_published ?? true,
    };
    const { error } = editingFaq.id
      ? await supabase.from('welcome_pack_faqs').update(payload).eq('id', editingFaq.id)
      : await supabase.from('welcome_pack_faqs').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('Question saved');
    setEditingFaq(null);
    void load();
  };

  const saveGroup = async () => {
    if (!editingGroup?.title) return toast.error('Title is required');
    const payload = {
      key: editingGroup.key || slugify(editingGroup.title),
      title: editingGroup.title,
      description: editingGroup.description || null,
      icon: editingGroup.icon || null,
      sort_order: editingGroup.sort_order ?? 0,
      is_published: editingGroup.is_published ?? true,
    };
    const { error } = editingGroup.id
      ? await supabase.from('welcome_pack_groups').update(payload).eq('id', editingGroup.id)
      : await supabase.from('welcome_pack_groups').insert(payload);
    if (error) return toast.error(error.message);
    toast.success('Chapter saved');
    setEditingGroup(null);
    void load();
  };

  const togglePublished = async (table: string, id: string, next: boolean) => {
    const { error } = await supabase.from(table).update({ is_published: next }).eq('id', id);
    if (error) return toast.error(error.message);
    void load();
  };

  const remove = async (table: string, id: string, label: string) => {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    void load();
  };

  /** Swap sort_order with the neighbour above/below within the same chapter. */
  const reorder = async (section: Section, direction: -1 | 1) => {
    const siblings = sections
      .filter((s) => s.group_id === section.group_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const i = siblings.findIndex((s) => s.id === section.id);
    const swap = siblings[i + direction];
    if (!swap) return;
    await Promise.all([
      supabase.from('welcome_pack_sections').update({ sort_order: swap.sort_order }).eq('id', section.id),
      supabase.from('welcome_pack_sections').update({ sort_order: section.sort_order }).eq('id', swap.id),
    ]);
    void load();
  };

  const saveSettings = async () => {
    if (!settings) return;
    const { error } = await supabase
      .from('welcome_pack_settings')
      .update({
        doc_title: settings.doc_title,
        doc_subtitle: settings.doc_subtitle,
        intro_md: settings.intro_md,
        show_on_first_login: settings.show_on_first_login,
        version: settings.version,
      })
      .eq('id', settings.id);
    if (error) return toast.error(error.message);
    toast.success('Settings saved');
    void load();
  };

  /* --------------------------------------------------------------- render */

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Welcome Pack</h1>
          <p className="text-sm text-muted-foreground">
            The onboarding document every operator sees. Global — one pack for all tenants.
          </p>
        </div>
      </div>

      <Tabs defaultValue="sections">
        <TabsList>
          <TabsTrigger value="sections">Pages ({sections.length})</TabsTrigger>
          <TabsTrigger value="faqs">Questions ({faqs.length})</TabsTrigger>
          <TabsTrigger value="chapters">Chapters ({groups.length})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="readership">Readership</TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------- pages */}
        <TabsContent value="sections" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditingSection({ is_published: true, sort_order: 0 })}>
              <Plus className="mr-2 h-4 w-4" /> New page
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Chapter</TableHead>
                    <TableHead>Only if</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{s.slug}</div>
                      </TableCell>
                      <TableCell className="text-sm">{groupName[s.group_id] ?? '—'}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {s.required_flag ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span className={s.is_published ? 'text-green-600' : 'text-muted-foreground'}>
                          {s.is_published ? 'Published' : 'Draft'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => reorder(s, -1)} title="Move up">
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => reorder(s, 1)} title="Move down">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={s.is_published ? 'Unpublish' : 'Publish'}
                            onClick={() => togglePublished('welcome_pack_sections', s.id, !s.is_published)}
                          >
                            {s.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setEditingSection(s)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove('welcome_pack_sections', s.id, s.title)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------- questions */}
        <TabsContent value="faqs" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditingFaq({ is_published: true, sort_order: 0 })}>
              <Plus className="mr-2 h-4 w-4" /> New question
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>Chapter</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faqs.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="max-w-md font-medium">{f.question}</TableCell>
                      <TableCell className="text-sm">
                        {f.group_id ? groupName[f.group_id] ?? '—' : '—'}
                      </TableCell>
                      <TableCell>
                        <span className={f.is_published ? 'text-green-600' : 'text-muted-foreground'}>
                          {f.is_published ? 'Published' : 'Draft'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => togglePublished('welcome_pack_faqs', f.id, !f.is_published)}
                          >
                            {f.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setEditingFaq(f)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove('welcome_pack_faqs', f.id, f.question)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ chapters */}
        <TabsContent value="chapters" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditingGroup({ is_published: true, sort_order: 0 })}>
              <Plus className="mr-2 h-4 w-4" /> New chapter
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">{g.title}</TableCell>
                      <TableCell className="font-mono text-xs">{g.key}</TableCell>
                      <TableCell>{sections.filter((s) => s.group_id === g.id).length}</TableCell>
                      <TableCell>
                        <span className={g.is_published ? 'text-green-600' : 'text-muted-foreground'}>
                          {g.is_published ? 'Published' : 'Draft'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => togglePublished('welcome_pack_groups', g.id, !g.is_published)}
                          >
                            {g.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setEditingGroup(g)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove('welcome_pack_groups', g.id, g.title)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ settings */}
        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardContent className="space-y-4 p-6">
              {settings ? (
                <>
                  <div>
                    <Label>Document title</Label>
                    <Input
                      value={settings.doc_title}
                      onChange={(e) => setSettings({ ...settings, doc_title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Subtitle</Label>
                    <Input
                      value={settings.doc_subtitle ?? ''}
                      onChange={(e) => setSettings({ ...settings, doc_subtitle: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Introduction (markdown)</Label>
                    <Textarea
                      rows={8}
                      className="font-mono text-xs"
                      value={settings.intro_md ?? ''}
                      onChange={(e) => setSettings({ ...settings, intro_md: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <Label>Show the first-login prompt</Label>
                      <p className="text-xs text-muted-foreground">
                        A dismissible dialog pointing new operators at the pack.
                      </p>
                    </div>
                    <Switch
                      checked={settings.show_on_first_login}
                      onCheckedChange={(v) => setSettings({ ...settings, show_on_first_login: v })}
                    />
                  </div>
                  <div className="rounded-lg border p-4">
                    <Label>Version — {settings.version}</Label>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Bumping this re-prompts every operator who has already completed the
                      pack. Use it after a substantial rewrite, not for typo fixes.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSettings({ ...settings, version: settings.version + 1 })}
                    >
                      Bump to {settings.version + 1}
                    </Button>
                  </div>
                  <Button onClick={saveSettings}>Save settings</Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No settings row found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- readership */}
        <TabsContent value="readership" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Pages read</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readership.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
                        Nobody has opened the pack yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {readership.map((r) => (
                    <TableRow key={r.app_user_id}>
                      <TableCell>
                        <div className="font-medium">{r.name || r.email}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.company_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.role}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.sections_read} / {sections.filter((s) => s.is_published).length}
                      </TableCell>
                      <TableCell>
                        {r.completed ? (
                          <span className="text-green-600">
                            {r.completed_at
                              ? new Date(r.completed_at).toLocaleDateString()
                              : 'Yes'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------------------------------------------- page dialog */}
      <Dialog open={!!editingSection} onOpenChange={(o) => !o && setEditingSection(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingSection?.id ? 'Edit page' : 'New page'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Chapter</Label>
                <Select
                  value={editingSection?.group_id ?? ''}
                  onValueChange={(v) => setEditingSection({ ...editingSection, group_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Icon</Label>
                <Select
                  value={editingSection?.icon ?? ''}
                  onValueChange={(v) => setEditingSection({ ...editingSection, icon: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {ICON_NAMES.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                value={editingSection?.title ?? ''}
                onChange={(e) => setEditingSection({ ...editingSection, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Summary</Label>
              <Input
                value={editingSection?.summary ?? ''}
                onChange={(e) => setEditingSection({ ...editingSection, summary: e.target.value })}
              />
            </div>
            <div>
              <Label>Body (markdown)</Label>
              <Textarea
                rows={16}
                className="font-mono text-xs"
                value={editingSection?.body_md ?? ''}
                onChange={(e) => setEditingSection({ ...editingSection, body_md: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Only show if tenant flag is true</Label>
                <Input
                  placeholder="e.g. lockbox_enabled — leave blank for everyone"
                  value={editingSection?.required_flag ?? ''}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, required_flag: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  A boolean column on <code>tenants</code>. If it cannot be resolved the page
                  is shown anyway — a typo never blanks the document.
                </p>
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={editingSection?.sort_order ?? 0}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, sort_order: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={editingSection?.is_published ?? true}
                onCheckedChange={(v) => setEditingSection({ ...editingSection, is_published: v })}
              />
              <Label>Published</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSection(null)}>Cancel</Button>
            <Button onClick={saveSection}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------- faq dialog */}
      <Dialog open={!!editingFaq} onOpenChange={(o) => !o && setEditingFaq(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingFaq?.id ? 'Edit question' : 'New question'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Chapter</Label>
              <Select
                value={editingFaq?.group_id ?? ''}
                onValueChange={(v) => setEditingFaq({ ...editingFaq, group_id: v })}
              >
                <SelectTrigger><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Question</Label>
              <Input
                value={editingFaq?.question ?? ''}
                onChange={(e) => setEditingFaq({ ...editingFaq, question: e.target.value })}
              />
            </div>
            <div>
              <Label>Answer (markdown)</Label>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                value={editingFaq?.answer_md ?? ''}
                onChange={(e) => setEditingFaq({ ...editingFaq, answer_md: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Only show if tenant flag is true</Label>
                <Input
                  value={editingFaq?.required_flag ?? ''}
                  onChange={(e) => setEditingFaq({ ...editingFaq, required_flag: e.target.value })}
                />
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={editingFaq?.sort_order ?? 0}
                  onChange={(e) => setEditingFaq({ ...editingFaq, sort_order: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={editingFaq?.is_published ?? true}
                onCheckedChange={(v) => setEditingFaq({ ...editingFaq, is_published: v })}
              />
              <Label>Published</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFaq(null)}>Cancel</Button>
            <Button onClick={saveFaq}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------- group dialog */}
      <Dialog open={!!editingGroup} onOpenChange={(o) => !o && setEditingGroup(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup?.id ? 'Edit chapter' : 'New chapter'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={editingGroup?.title ?? ''}
                onChange={(e) => setEditingGroup({ ...editingGroup, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={editingGroup?.description ?? ''}
                onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Icon</Label>
                <Select
                  value={editingGroup?.icon ?? ''}
                  onValueChange={(v) => setEditingGroup({ ...editingGroup, icon: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {ICON_NAMES.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={editingGroup?.sort_order ?? 0}
                  onChange={(e) =>
                    setEditingGroup({ ...editingGroup, sort_order: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={editingGroup?.is_published ?? true}
                onCheckedChange={(v) => setEditingGroup({ ...editingGroup, is_published: v })}
              />
              <Label>Published</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGroup(null)}>Cancel</Button>
            <Button onClick={saveGroup}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
