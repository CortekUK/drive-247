import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Edit, Trash2, GripVertical, Search, HelpCircle, ChevronUp, ChevronDown } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

const MAX_QUESTION = 100;
const MAX_ANSWER = 1000;
const CATEGORIES = ["Booking", "Pricing", "Cancellations", "Services", "Other"];

const SortableFAQCard = ({ faq, onEdit, onDelete, onToggleActive, onMoveUp, onMoveDown, isFirst, isLast }: {
  faq: FAQ;
  onEdit: (f: FAQ) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, value: boolean) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: faq.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="p-6 shadow-metal hover:shadow-glow transition-all duration-300 hover:-translate-y-1"
    >
      <div className="flex gap-4">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
          aria-label="Drag to reorder FAQ"
        >
          <GripVertical className="w-5 h-5 text-muted-foreground hover:text-accent transition-colors" />
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-accent/20 text-accent border-accent/30 font-medium">
                  {faq.category}
                </Badge>
                {!faq.is_active && (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>
              <h3 className="text-lg font-display font-bold text-gradient-silver mb-2">
                {faq.question}
              </h3>
              <p
                className="text-sm text-muted-foreground line-clamp-3"
                title={faq.answer}
              >
                {faq.answer}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-3 border-t border-border/50 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch
                checked={faq.is_active}
                onCheckedChange={(checked) => onToggleActive(faq.id, checked)}
                aria-label={`Toggle active status for FAQ: ${faq.question}`}
              />
              <Label className="text-xs text-muted-foreground">Active</Label>
            </div>

            <div className="flex gap-2 ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onMoveUp(faq.id)}
                disabled={isFirst}
                aria-label="Move FAQ up"
                title="Move up"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onMoveDown(faq.id)}
                disabled={isLast}
                aria-label="Move FAQ down"
                title="Move down"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(faq)}
                aria-label={`Edit FAQ: ${faq.question}`}
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDelete(faq.id)}
                aria-label={`Delete FAQ: ${faq.question}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

const FAQManagement = () => {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingFAQ, setEditingFAQ] = useState<FAQ | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [formData, setFormData] = useState({
    category: "Booking",
    question: "",
    answer: "",
    is_active: true,
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadFAQs();
  }, []);

  const loadFAQs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("faqs")
      .select("*")
      .order("category", { ascending: true })
      .order("display_order", { ascending: true });

    if (error) {
      toast.error("Failed to load FAQs");
    } else {
      setFaqs(data || []);
    }
    setLoading(false);
  };

  const logAudit = async (action: string, entityId: string, details?: any) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("audit_logs").insert([{
      action,
      resource_type: "faqs",
      resource_id: entityId,
      new_values: details as any,
    } as any]);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = faqs.findIndex((f) => f.id === active.id);
    const newIndex = faqs.findIndex((f) => f.id === over.id);

    const newOrder = arrayMove(faqs, oldIndex, newIndex);
    setFaqs(newOrder);

    const updates = newOrder.map((item, index) => ({
      id: item.id,
      display_order: index,
    }));

    try {
      for (const update of updates) {
        await supabase
          .from("faqs")
          .update({ display_order: update.display_order })
          .eq("id", update.id);
      }
      toast.success("FAQ order updated");
      await logAudit("reorder", "bulk", { updates });
    } catch (error) {
      toast.error("Couldn't save changes, please try again");
      loadFAQs();
    }
  };

  const handleMoveUp = async (id: string) => {
    const index = faqs.findIndex(f => f.id === id);
    if (index <= 0) return;
    
    const newOrder = [...faqs];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setFaqs(newOrder);

    try {
      await supabase.from("faqs").update({ display_order: index - 1 }).eq("id", id);
      await supabase.from("faqs").update({ display_order: index }).eq("id", newOrder[index].id);
      toast.success("FAQ order updated");
    } catch (error) {
      toast.error("Couldn't save changes, please try again");
      loadFAQs();
    }
  };

  const handleMoveDown = async (id: string) => {
    const index = faqs.findIndex(f => f.id === id);
    if (index >= faqs.length - 1) return;
    
    const newOrder = [...faqs];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setFaqs(newOrder);

    try {
      await supabase.from("faqs").update({ display_order: index + 1 }).eq("id", id);
      await supabase.from("faqs").update({ display_order: index }).eq("id", newOrder[index].id);
      toast.success("FAQ order updated");
    } catch (error) {
      toast.error("Couldn't save changes, please try again");
      loadFAQs();
    }
  };

  const handleToggleActive = async (id: string, value: boolean) => {
    const oldFAQs = [...faqs];
    setFaqs(faqs.map(f => f.id === id ? { ...f, is_active: value } : f));

    const { error } = await supabase
      .from("faqs")
      .update({ is_active: value })
      .eq("id", id);

    if (error) {
      toast.error("Couldn't save changes, please try again");
      setFaqs(oldFAQs);
    } else {
      toast.success(`FAQ ${value ? 'activated' : 'deactivated'}`);
      await logAudit("update", id, { is_active: value });
    }
  };

  const isFormValid = useMemo(() => {
    const questionValid = formData.question.trim().length > 0 && formData.question.length <= MAX_QUESTION;
    const answerValid = formData.answer.trim().length > 0 && formData.answer.length <= MAX_ANSWER;
    return questionValid && answerValid;
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) {
      toast.error("Please check all fields and try again");
      return;
    }

    if (editingFAQ) {
      const { error } = await supabase
        .from("faqs")
        .update(formData)
        .eq("id", editingFAQ.id);

      if (error) {
        toast.error("Failed to update FAQ");
        return;
      }
      toast.success("FAQ updated");
      await logAudit("update", editingFAQ.id, formData);
    } else {
      const maxOrder = faqs.reduce((max, f) => Math.max(max, f.display_order || 0), 0);
      const { data, error } = await supabase
        .from("faqs")
        .insert({ ...formData, display_order: maxOrder + 1 })
        .select()
        .single();

      if (error) {
        toast.error("Failed to create FAQ");
        return;
      }
      toast.success("FAQ added successfully");
      if (data) await logAudit("create", data.id, formData);
    }

    setDialogOpen(false);
    resetForm();
    loadFAQs();
  };

  const confirmDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    const { error } = await supabase.from("faqs").delete().eq("id", deletingId);

    if (error) {
      toast.error("Failed to delete FAQ");
      return;
    }

    toast.success("FAQ removed");
    await logAudit("delete", deletingId, {});
    setDeleteDialogOpen(false);
    setDeletingId(null);
    loadFAQs();
  };

  const handleEdit = (faq: FAQ) => {
    setEditingFAQ(faq);
    setFormData({
      category: faq.category,
      question: faq.question,
      answer: faq.answer,
      is_active: faq.is_active,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingFAQ(null);
    setFormData({
      category: "Booking",
      question: "",
      answer: "",
      is_active: true,
    });
  };

  const filteredFAQs = useMemo(() => {
    let result = [...faqs];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.question.toLowerCase().includes(query) ||
          f.answer.toLowerCase().includes(query)
      );
    }

    if (filterStatus === "active") {
      result = result.filter((f) => f.is_active);
    } else if (filterStatus === "inactive") {
      result = result.filter((f) => !f.is_active);
    }

    return result;
  }, [faqs, searchQuery, filterStatus]);

  const questionLength = formData.question.length;
  const answerLength = formData.answer.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal">FAQ Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage FAQs displayed on the public website
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-accent shadow-glow" onClick={resetForm}>
              <Plus className="w-4 h-4 mr-2" />
              Add FAQ
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingFAQ ? "Edit FAQ" : "Add FAQ"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="question">
                  Question <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="question"
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  maxLength={MAX_QUESTION}
                  required
                  placeholder="Enter your question"
                />
                <p className="text-xs text-muted-foreground">
                  {questionLength}/{MAX_QUESTION} characters
                  {questionLength > 0 && questionLength <= MAX_QUESTION && (
                    <span className="text-accent ml-2">✓ Valid length</span>
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="answer">
                  Answer <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="answer"
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  rows={6}
                  maxLength={MAX_ANSWER}
                  required
                  placeholder="Enter your answer"
                />
                <p className="text-xs text-muted-foreground">
                  {answerLength}/{MAX_ANSWER} characters
                  {answerLength > 0 && answerLength <= MAX_ANSWER && (
                    <span className="text-accent ml-2">✓ Valid length</span>
                  )}
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="active">Active</Label>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  className="gradient-accent shadow-glow"
                  disabled={!isFormValid}
                >
                  {editingFAQ ? "Save FAQ" : "Create FAQ"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-4 items-center justify-between bg-card/50 p-4 rounded-lg border border-border/50">
        <div className="flex items-center gap-2 flex-1 min-w-[250px]">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search FAQs…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filterStatus === "all" ? "default" : "outline"}
            onClick={() => setFilterStatus("all")}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filterStatus === "active" ? "default" : "outline"}
            onClick={() => setFilterStatus("active")}
          >
            Active
          </Button>
          <Button
            size="sm"
            variant={filterStatus === "inactive" ? "default" : "outline"}
            onClick={() => setFilterStatus("inactive")}
          >
            Inactive
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : filteredFAQs.length === 0 ? (
        <Card className="p-12 text-center shadow-metal">
          <HelpCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-display font-bold mb-2">No FAQs yet</h3>
          <p className="text-muted-foreground mb-6">
            Add frequently asked questions to assist website visitors
          </p>
          <Button className="gradient-accent shadow-glow" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add FAQ
          </Button>
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filteredFAQs.map(f => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {filteredFAQs.map((faq, index) => (
                <SortableFAQCard
                  key={faq.id}
                  faq={faq}
                  onEdit={handleEdit}
                  onDelete={confirmDelete}
                  onToggleActive={handleToggleActive}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  isFirst={index === 0}
                  isLast={index === filteredFAQs.length - 1}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this FAQ?</AlertDialogTitle>
            <AlertDialogDescription>
              This FAQ will be permanently removed from the website. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FAQManagement;
