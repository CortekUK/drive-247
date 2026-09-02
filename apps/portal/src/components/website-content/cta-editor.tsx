import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface CTAContent {
  title: string;
  description: string;
  button_text?: string;
  tagline?: string;
}

interface CTAEditorProps {
  content: CTAContent;
  onSave: (content: CTAContent) => void;
  isSaving: boolean;
  title: string;
  description: string;
  icon: LucideIcon;
  showButtonText?: boolean;
  showTagline?: boolean;
}

export function CTAEditor({
  content,
  onSave,
  isSaving,
  title,
  description,
  icon: Icon,
  showButtonText = true,
  showTagline = false,
}: CTAEditorProps) {
  const [formData, setFormData] = useState<CTAContent>(content);

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
          <Icon className="h-5 w-5 text-accent" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="cta-title">Title</Label>
          <Input
            id="cta-title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="CTA Title"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cta-description">Description</Label>
          <Textarea
            id="cta-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="CTA description..."
            rows={3}
          />
        </div>

        {showButtonText && (
          <div className="space-y-2">
            <Label htmlFor="cta-button">Button Text</Label>
            <Input
              id="cta-button"
              value={formData.button_text || ""}
              onChange={(e) => setFormData({ ...formData, button_text: e.target.value })}
              placeholder="Button text"
            />
          </div>
        )}

        {showTagline && (
          <div className="space-y-2">
            <Label htmlFor="cta-tagline">Tagline</Label>
            <Input
              id="cta-tagline"
              value={formData.tagline || ""}
              onChange={(e) => setFormData({ ...formData, tagline: e.target.value })}
              placeholder="Optional tagline"
            />
          </div>
        )}

        {/* Preview */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-3">Preview</p>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-display font-bold">
              {formData.title || "CTA Title"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {formData.description || "CTA description"}
            </p>
            {showButtonText && formData.button_text && (
              <div className="pt-2">
                <span className="inline-block px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium">
                  {formData.button_text}
                </span>
              </div>
            )}
            {showTagline && formData.tagline && (
              <p className="text-xs text-muted-foreground italic">{formData.tagline}</p>
            )}
          </div>
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
