'use client';

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Eye, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import EmailTemplateDialog from "@/components/settings/email-template-dialog";
import EmailTemplatePreview from "@/components/settings/email-template-preview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function EmailTemplatesPage() {
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  // Fetch templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['email-templates', categoryFilter],
    queryFn: async () => {
      let query = supabase
        .from('email_templates')
        .select('*')
        .order('category', { ascending: true })
        .order('created_at', { ascending: false });

      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from('email_templates')
        .delete()
        .eq('id', templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast({ title: "Template deleted successfully" });
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting template",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Filter templates by search query
  const filteredTemplates = templates?.filter(template =>
    template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    template.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = () => {
    setSelectedTemplate(null);
    setDialogOpen(true);
  };

  const handleEdit = (template: any) => {
    setSelectedTemplate(template);
    setDialogOpen(true);
  };

  const handlePreview = (template: any) => {
    setSelectedTemplate(template);
    setPreviewOpen(true);
  };

  const handleDelete = (templateId: string) => {
    setTemplateToDelete(templateId);
    setDeleteDialogOpen(true);
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'rejection': return 'destructive';
      case 'approval': return 'default';
      case 'reminder': return 'secondary';
      case 'general': return 'outline';
      default: return 'outline';
    }
  };

  const getCategoryCount = (category: string) => {
    if (!templates) return 0;
    if (category === 'all') return templates.length;
    return templates.filter(t => t.category === category).length;
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Email Templates</h1>
          <p className="text-muted-foreground mt-1">
            Manage email templates for customer communications
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Category Filter */}
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories ({getCategoryCount('all')})</SelectItem>
            <SelectItem value="rejection">Rejection ({getCategoryCount('rejection')})</SelectItem>
            <SelectItem value="approval">Approval ({getCategoryCount('approval')})</SelectItem>
            <SelectItem value="reminder">Reminder ({getCategoryCount('reminder')})</SelectItem>
            <SelectItem value="general">General ({getCategoryCount('general')})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Templates Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading templates...</p>
        </div>
      ) : filteredTemplates && filteredTemplates.length > 0 ? (
        <div className="grid gap-4">
          {filteredTemplates.map((template) => (
            <Card key={template.id} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-lg truncate">{template.name}</h3>
                    <Badge variant={getCategoryColor(template.category)}>
                      {template.category}
                    </Badge>
                    {!template.is_active && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-1">
                    <span className="font-medium">Subject:</span> {template.subject}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      Variables: {JSON.parse(template.variables || '[]').length > 0
                        ? JSON.parse(template.variables || '[]').join(', ')
                        : 'None'}
                    </span>
                    <span>•</span>
                    <span>
                      Updated {new Date(template.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePreview(template)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(template)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(template.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {searchQuery ? 'No templates match your search' : 'No email templates yet'}
          </p>
          {!searchQuery && (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Template
            </Button>
          )}
        </Card>
      )}

      {/* Template Dialog */}
      <EmailTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={selectedTemplate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['email-templates'] });
          setDialogOpen(false);
        }}
      />

      {/* Preview Dialog */}
      <EmailTemplatePreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        template={selectedTemplate}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the email template.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => templateToDelete && deleteMutation.mutate(templateToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
