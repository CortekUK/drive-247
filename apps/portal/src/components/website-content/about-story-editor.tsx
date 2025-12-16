import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2, BookOpen } from "lucide-react";
import { RichTextEditor } from "./rich-text-editor";

interface AboutStoryContent {
  title: string;
  founded_year: string;
  content: string;
}

interface AboutStoryEditorProps {
  content: AboutStoryContent;
  onSave: (content: AboutStoryContent) => void;
  isSaving: boolean;
}

export function AboutStoryEditor({ content, onSave, isSaving }: AboutStoryEditorProps) {
  const [formData, setFormData] = useState<AboutStoryContent>(content);

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
          <BookOpen className="h-5 w-5 text-accent" />
          About Story Section
        </CardTitle>
        <CardDescription>
          Edit the main story content for the About page using the rich text editor below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="story-title">Section Title</Label>
            <Input
              id="story-title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Excellence in Every Rental"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="founded-year">Founded Year</Label>
            <Input
              id="founded-year"
              value={formData.founded_year}
              onChange={(e) => setFormData({ ...formData, founded_year: e.target.value })}
              placeholder="2010"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Story Content</Label>
          <RichTextEditor
            content={formData.content}
            onChange={(content) => setFormData({ ...formData, content })}
            placeholder="Write your story here..."
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
            Save Section
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
