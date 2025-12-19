import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { Plus, Edit, Trash2, GripVertical, Search, HelpCircle, ChevronUp, ChevronDown } from "lucide-react";

interface FAQ {
  id: string;
  question: string;
  answer: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

const MAX_QUESTION = 200;
const MAX_ANSWER = 2000;

const faqFormSchema = z.object({
  question: z.string().min(1, "Question is required").max(MAX_QUESTION, `Maximum ${MAX_QUESTION} characters`),
  answer: z.string().min(1, "Answer is required").max(MAX_ANSWER, `Maximum ${MAX_ANSWER} characters`),
  is_active: z.boolean(),
});

type FAQFormValues = z.infer<typeof faqFormSchema>;

export function FAQsManager() {
  const { tenant } = useTenant();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingFAQ, setEditingFAQ] = useState<FAQ | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const form = useForm<FAQFormValues>({
    resolver: zodResolver(faqFormSchema),
    defaultValues: {
      question: "",
      answer: "",
      is_active: true,
    },
  });

  useEffect(() => {
    if (tenant?.id) {
      loadFAQs();
    }
  }, [tenant?.id]);

  const loadFAQs = async () => {
    setLoading(true);
    let query = supabase
      .from("faqs")
      .select("*")
      .order("display_order", { ascending: true });

    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to load FAQs:", error);
      toast.error("Failed to load FAQs");
    } else {
      setFaqs(data || []);
    }
    setLoading(false);
  };

  const handleMoveUp = async (id: string) => {
    const index = faqs.findIndex(f => f.id === id);
    if (index <= 0) return;

    const newOrder = [...faqs];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setFaqs(newOrder);

    try {
      let query1 = supabase.from("faqs").update({ display_order: index - 1 }).eq("id", id);
      let query2 = supabase.from("faqs").update({ display_order: index }).eq("id", newOrder[index].id);

      if (tenant?.id) {
        query1 = query1.eq("tenant_id", tenant.id);
        query2 = query2.eq("tenant_id", tenant.id);
      }

      await query1;
      await query2;
      toast.success("FAQ order updated");
    } catch {
      toast.error("Failed to update order");
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
      let query1 = supabase.from("faqs").update({ display_order: index + 1 }).eq("id", id);
      let query2 = supabase.from("faqs").update({ display_order: index }).eq("id", newOrder[index].id);

      if (tenant?.id) {
        query1 = query1.eq("tenant_id", tenant.id);
        query2 = query2.eq("tenant_id", tenant.id);
      }

      await query1;
      await query2;
      toast.success("FAQ order updated");
    } catch {
      toast.error("Failed to update order");
      loadFAQs();
    }
  };

  const handleToggleActive = async (id: string, value: boolean) => {
    const oldFAQs = [...faqs];
    setFaqs(faqs.map(f => f.id === id ? { ...f, is_active: value } : f));

    let query = supabase
      .from("faqs")
      .update({ is_active: value })
      .eq("id", id);

    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    const { error } = await query;

    if (error) {
      toast.error("Failed to update FAQ");
      setFaqs(oldFAQs);
    } else {
      toast.success(`FAQ ${value ? 'activated' : 'deactivated'}`);
    }
  };

  const onSubmit = async (data: FAQFormValues) => {
    if (editingFAQ) {
      let updateQuery = supabase
        .from("faqs")
        .update({
          question: data.question,
          answer: data.answer,
          is_active: data.is_active,
        })
        .eq("id", editingFAQ.id);

      if (tenant?.id) {
        updateQuery = updateQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await updateQuery;

      if (error) {
        console.error("FAQ update error:", error);
        toast.error(`Failed to update FAQ: ${error.message}`);
        return;
      }
      toast.success("FAQ updated");
    } else {
      const maxOrder = faqs.reduce((max, f) => Math.max(max, f.display_order || 0), 0);
      const { error } = await supabase
        .from("faqs")
        .insert({
          question: data.question,
          answer: data.answer,
          is_active: data.is_active,
          display_order: maxOrder + 1,
          tenant_id: tenant?.id || null,
        });

      if (error) {
        console.error("FAQ insert error:", error);
        toast.error(`Failed to create FAQ: ${error.message}`);
        return;
      }
      toast.success("FAQ added successfully");
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

    let deleteQuery = supabase.from("faqs").delete().eq("id", deletingId);

    if (tenant?.id) {
      deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
    }

    const { error } = await deleteQuery;

    if (error) {
      toast.error("Failed to delete FAQ");
      return;
    }

    toast.success("FAQ removed");
    setDeleteDialogOpen(false);
    setDeletingId(null);
    loadFAQs();
  };

  const handleEdit = (faq: FAQ) => {
    setEditingFAQ(faq);
    form.reset({
      question: faq.question,
      answer: faq.answer,
      is_active: faq.is_active,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingFAQ(null);
    form.reset({
      question: "",
      answer: "",
      is_active: true,
    });
  };

  const filteredFAQs = useMemo(() => {
    if (!searchQuery.trim()) return faqs;

    const query = searchQuery.toLowerCase();
    return faqs.filter(
      (f) =>
        f.question.toLowerCase().includes(query) ||
        f.answer.toLowerCase().includes(query)
    );
  }, [faqs, searchQuery]);

  const questionValue = form.watch("question");
  const answerValue = form.watch("answer");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-accent" />
              FAQs Management
            </CardTitle>
            <CardDescription>
              Manage frequently asked questions displayed on the About page
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
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
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="question"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Question <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter the question"
                            maxLength={MAX_QUESTION}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {questionValue.length}/{MAX_QUESTION} characters
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="answer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Answer <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Enter the answer"
                            rows={6}
                            maxLength={MAX_ANSWER}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {answerValue.length}/{MAX_ANSWER} characters
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="is_active"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">Active</FormLabel>
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-3 pt-2">
                    <Button type="submit">
                      {editingFAQ ? "Save FAQ" : "Create FAQ"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search FAQs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {/* FAQ List */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : filteredFAQs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            <HelpCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No FAQs found. Click "Add FAQ" to create one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFAQs.map((faq, index) => (
              <Card key={faq.id} className="p-4 bg-muted/30">
                <div className="flex gap-3">
                  <div className="flex flex-col gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => handleMoveUp(faq.id)}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <GripVertical className="h-5 w-5 text-muted-foreground mx-auto" />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => handleMoveDown(faq.id)}
                      disabled={index === filteredFAQs.length - 1}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {!faq.is_active && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    <h4 className="font-medium text-sm mb-1">{faq.question}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2">{faq.answer}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={faq.is_active}
                        onCheckedChange={(checked) => handleToggleActive(faq.id, checked)}
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleEdit(faq)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => confirmDelete(faq.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this FAQ?</AlertDialogTitle>
            <AlertDialogDescription>
              This FAQ will be permanently removed. This action cannot be undone.
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
    </Card>
  );
}
