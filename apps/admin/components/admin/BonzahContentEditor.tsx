'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  GraduationCap,
  ClipboardCheck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  CheckCircle2,
} from 'lucide-react';

interface TrainingVideo {
  id: string;
  title: string;
  description: string | null;
  loom_url: string;
  sort_order: number;
  is_active: boolean;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct_option_index: number;
  sort_order: number;
  is_active: boolean;
}

export default function BonzahContentEditor() {
  const [videos, setVideos] = useState<TrainingVideo[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editVideo, setEditVideo] = useState<Partial<TrainingVideo> | null>(null);
  const [editQuestion, setEditQuestion] = useState<Partial<QuizQuestion> | null>(null);

  const load = async () => {
    setLoading(true);
    const [v, q] = await Promise.all([
      supabase.from('bonzah_training_videos').select('*').order('sort_order'),
      supabase.from('bonzah_quiz_questions').select('*').order('sort_order'),
    ]);
    if (v.error) toast.error('Videos: ' + v.error.message);
    if (q.error) toast.error('Questions: ' + q.error.message);
    setVideos((v.data as any) || []);
    setQuestions(
      ((q.data as any[]) || []).map((row) => ({
        ...row,
        options: Array.isArray(row.options) ? row.options : [],
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const removeVideo = async (id: string) => {
    if (!confirm('Delete this training video?')) return;
    const { error } = await supabase.from('bonzah_training_videos').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    void load();
  };

  const removeQuestion = async (id: string) => {
    if (!confirm('Delete this quiz question?')) return;
    const { error } = await supabase.from('bonzah_quiz_questions').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    void load();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Training videos */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" /> Training Videos
          </h3>
          <Button
            size="sm"
            onClick={() =>
              setEditVideo({ title: '', description: '', loom_url: '', sort_order: videos.length + 1, is_active: true })
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Add video
          </Button>
        </div>
        {videos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No videos yet.</p>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <Card key={v.id}>
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {v.title}{' '}
                      {!v.is_active && <span className="text-xs text-muted-foreground">(hidden)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{v.loom_url}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditVideo(v)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeVideo(v.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Quiz questions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" /> Quiz Questions
          </h3>
          <Button
            size="sm"
            onClick={() =>
              setEditQuestion({
                question: '',
                options: ['', ''],
                correct_option_index: 0,
                sort_order: questions.length + 1,
                is_active: true,
              })
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Add question
          </Button>
        </div>
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet.</p>
        ) : (
          <div className="space-y-2">
            {questions.map((q) => (
              <Card key={q.id}>
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {q.question}{' '}
                      {!q.is_active && <span className="text-xs text-muted-foreground">(hidden)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {q.options.length} options · correct: #{q.correct_option_index + 1}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditQuestion(q)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeQuestion(q.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {editVideo && (
        <VideoDialog video={editVideo} onClose={() => setEditVideo(null)} onSaved={load} />
      )}
      {editQuestion && (
        <QuestionDialog question={editQuestion} onClose={() => setEditQuestion(null)} onSaved={load} />
      )}
    </div>
  );
}

function VideoDialog({
  video,
  onClose,
  onSaved,
}: {
  video: Partial<TrainingVideo>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<TrainingVideo>>(video);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.title?.trim() || !form.loom_url?.trim()) {
      return toast.error('Title and Loom URL are required');
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description?.trim() || null,
      loom_url: form.loom_url.trim(),
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from('bonzah_training_videos').update(payload).eq('id', form.id)
      : await supabase.from('bonzah_training_videos').insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success('Saved');
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? 'Edit' : 'Add'} training video</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Title</Label>
            <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label className="mb-1.5 block">Description</Label>
            <Textarea
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Loom embed URL</Label>
            <Input
              value={form.loom_url || ''}
              onChange={(e) => setForm({ ...form, loom_url: e.target.value })}
              placeholder="https://www.loom.com/embed/…"
            />
          </div>
          <div className="flex items-center gap-6">
            <div className="w-28">
              <Label className="mb-1.5 block">Sort order</Label>
              <Input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 mt-6 text-sm">
              <Switch
                checked={form.is_active ?? true}
                onCheckedChange={(c) => setForm({ ...form, is_active: c })}
              />
              Active
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuestionDialog({
  question,
  onClose,
  onSaved,
}: {
  question: Partial<QuizQuestion>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<QuizQuestion>>({
    ...question,
    options: question.options && question.options.length ? question.options : ['', ''],
  });
  const [saving, setSaving] = useState(false);

  const options = form.options || [];
  const setOption = (i: number, val: string) =>
    setForm({ ...form, options: options.map((o, idx) => (idx === i ? val : o)) });
  const addOption = () => setForm({ ...form, options: [...options, ''] });
  const removeOption = (i: number) => {
    const next = options.filter((_, idx) => idx !== i);
    let correct = form.correct_option_index ?? 0;
    if (correct >= next.length) correct = 0;
    setForm({ ...form, options: next, correct_option_index: correct });
  };

  const save = async () => {
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (!form.question?.trim() || cleaned.length < 2) {
      return toast.error('A question and at least 2 options are required');
    }
    if ((form.correct_option_index ?? 0) >= cleaned.length) {
      return toast.error('Pick which option is correct');
    }
    setSaving(true);
    const payload = {
      question: form.question.trim(),
      options: cleaned,
      correct_option_index: form.correct_option_index ?? 0,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from('bonzah_quiz_questions').update(payload).eq('id', form.id)
      : await supabase.from('bonzah_quiz_questions').insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success('Saved');
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Edit' : 'Add'} quiz question</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Question</Label>
            <Textarea
              value={form.question || ''}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              rows={2}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Options (tick the correct one)</Label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    title="Mark correct"
                    onClick={() => setForm({ ...form, correct_option_index: i })}
                    className="shrink-0"
                  >
                    <CheckCircle2
                      className={
                        form.correct_option_index === i
                          ? 'h-5 w-5 text-emerald-600'
                          : 'h-5 w-5 text-muted-foreground/40'
                      }
                    />
                  </button>
                  <Input value={opt} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />
                  {options.length > 2 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeOption(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addOption}>
              <Plus className="h-4 w-4 mr-1" /> Add option
            </Button>
          </div>
          <div className="flex items-center gap-6">
            <div className="w-28">
              <Label className="mb-1.5 block">Sort order</Label>
              <Input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 mt-6 text-sm">
              <Switch
                checked={form.is_active ?? true}
                onCheckedChange={(c) => setForm({ ...form, is_active: c })}
              />
              Active
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
