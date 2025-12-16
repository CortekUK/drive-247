'use client';

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';

// Dynamically import ReactQuill to avoid SSR issues
const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: any;
  onSuccess: () => void;
}

const AVAILABLE_VARIABLES = [
  'customerName',
  'bookingRef',
  'rejectionReason',
  'refundAmount',
  'vehicleName',
  'pickupDate',
  'returnDate',
  'totalAmount',
  'dueDate',
  'amountDue'
];

export default function EmailTemplateDialog({ open, onOpenChange, template, onSuccess }: Props) {
  const [formData, setFormData] = useState({
    name: '',
    category: 'general' as 'rejection' | 'approval' | 'reminder' | 'general',
    subject: '',
    body: '',
    is_active: true
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setFormData({
        name: template.name || '',
        category: template.category || 'general',
        subject: template.subject || '',
        body: template.body || '',
        is_active: template.is_active ?? true
      });
    } else {
      setFormData({
        name: '',
        category: 'general',
        subject: '',
        body: '',
        is_active: true
      });
    }
  }, [template, open]);

  const handleSave = async () => {
    if (!formData.name || !formData.subject || !formData.body) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    try {
      // Extract variables from template body
      const variablePattern = /\{\{(\w+)\}\}/g;
      const matches = formData.body.matchAll(variablePattern);
      const extractedVariables = Array.from(new Set(
        Array.from(matches).map(match => match[1])
      ));

      const templateData = {
        ...formData,
        variables: JSON.stringify(extractedVariables)
      };

      if (template?.id) {
        // Update existing
        const { error } = await supabase
          .from('email_templates')
          .update(templateData)
          .eq('id', template.id);

        if (error) throw error;
        toast({ title: "Template updated successfully" });
      } else {
        // Insert new
        const { error } = await supabase
          .from('email_templates')
          .insert(templateData);

        if (error) throw error;
        toast({ title: "Template created successfully" });
      }

      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (variable: string) => {
    const placeholder = `{{${variable}}}`;
    setFormData(prev => ({
      ...prev,
      body: prev.body + placeholder
    }));
  };

  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      [{ 'align': [] }],
      ['link'],
      ['clean']
    ]
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit Template' : 'New Template'}</DialogTitle>
          <DialogDescription>
            Create or edit email templates with rich text formatting and variable support
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Template Name */}
          <div>
            <Label htmlFor="name">Template Name <span className="text-red-500">*</span></Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., booking_rejection_with_refund"
            />
          </div>

          {/* Category and Active Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category <span className="text-red-500">*</span></Label>
              <Select
                value={formData.category}
                onValueChange={(v: any) => setFormData({ ...formData, category: v })}
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rejection">Rejection</SelectItem>
                  <SelectItem value="approval">Approval</SelectItem>
                  <SelectItem value="reminder">Reminder</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2 pt-8">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>

          {/* Subject Line */}
          <div>
            <Label htmlFor="subject">Subject Line <span className="text-red-500">*</span></Label>
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="e.g., Booking Update - {{bookingRef}}"
            />
            <p className="text-xs text-muted-foreground mt-1">
              You can use variables like {`{{customerName}}`} in the subject
            </p>
          </div>

          {/* Available Variables */}
          <div>
            <Label>Available Variables</Label>
            <div className="flex flex-wrap gap-2 mt-2 p-3 bg-muted rounded-lg">
              {AVAILABLE_VARIABLES.map((variable) => (
                <Badge
                  key={variable}
                  variant="secondary"
                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                  onClick={() => insertVariable(variable)}
                >
                  {`{{${variable}}}`}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Click on a variable to insert it into the template body at the cursor position
            </p>
          </div>

          {/* Email Body - Rich Text Editor */}
          <div>
            <Label htmlFor="body">Email Body (HTML) <span className="text-red-500">*</span></Label>
            <div className="mt-2 border rounded-md">
              <ReactQuill
                theme="snow"
                value={formData.body}
                onChange={(value) => setFormData({ ...formData, body: value })}
                modules={quillModules}
                className="min-h-[300px]"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Use {`{{variableName}}`} syntax for dynamic content. Supports Handlebars conditionals like {`{{#if variable}}...{{/if}}`}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                template ? 'Update Template' : 'Create Template'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
