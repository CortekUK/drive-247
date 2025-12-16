import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2, FileText } from "lucide-react";
import { RichTextEditor } from "./rich-text-editor";

interface LegalPageContent {
  title: string;
  content: string;
  last_updated: string;
}

interface LegalPageEditorProps {
  content: LegalPageContent;
  onSave: (content: LegalPageContent) => void;
  isSaving: boolean;
  pageTitle: string;
  pageDescription: string;
}

export function LegalPageEditor({ content, onSave, isSaving, pageTitle, pageDescription }: LegalPageEditorProps) {
  const [formData, setFormData] = useState<LegalPageContent>(content);

  useEffect(() => {
    setFormData(content);
  }, [content]);

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent" />
          {pageTitle}
        </CardTitle>
        <CardDescription>
          {pageDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="page-title">Page Title</Label>
            <Input
              id="page-title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Privacy Policy"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-updated">Last Updated Date</Label>
            <Input
              id="last-updated"
              type="date"
              value={formData.last_updated}
              onChange={(e) => setFormData({ ...formData, last_updated: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Page Content</Label>
          <RichTextEditor
            content={formData.content}
            onChange={(content) => setFormData({ ...formData, content })}
            placeholder="Write your content here..."
          />
          <p className="text-xs text-muted-foreground">
            Use the toolbar above to format text, add headings, lists, links, and more.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
