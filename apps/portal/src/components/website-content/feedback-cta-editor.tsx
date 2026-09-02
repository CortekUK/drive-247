import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, MessageSquare } from "lucide-react";

interface FeedbackCTAContent {
  title: string;
  description: string;
  button_text: string;
  empty_state_message: string;
}

interface FeedbackCTAEditorProps {
  content: FeedbackCTAContent;
  onSave: (content: FeedbackCTAContent) => void;
  isSaving: boolean;
}

export function FeedbackCTAEditor({ content, onSave, isSaving }: FeedbackCTAEditorProps) {
  const [formData, setFormData] = useState<FeedbackCTAContent>(content);

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
          <MessageSquare className="h-5 w-5 text-accent" />
          Feedback CTA Section
        </CardTitle>
        <CardDescription>
          Customize the feedback call-to-action shown on the Reviews page
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="feedback-title">Title</Label>
          <Input
            id="feedback-title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Would you like to share your experience?"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-description">Description</Label>
          <Textarea
            id="feedback-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="We value your feedback and would love to hear about your rental experience..."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-button">Button Text</Label>
          <Input
            id="feedback-button"
            value={formData.button_text}
            onChange={(e) => setFormData({ ...formData, button_text: e.target.value })}
            placeholder="Submit Feedback"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-empty">Empty State Message</Label>
          <Input
            id="feedback-empty"
            value={formData.empty_state_message}
            onChange={(e) => setFormData({ ...formData, empty_state_message: e.target.value })}
            placeholder="Be the first to share your experience."
          />
          <p className="text-xs text-muted-foreground">
            Shown when there are no reviews yet
          </p>
        </div>

        {/* Preview */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-2">Preview</p>
          <h3 className="text-xl font-display font-bold mb-1">
            {formData.title || "Would you like to share your experience?"}
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            {formData.description || "We value your feedback and would love to hear about your rental experience."}
          </p>
          <Button size="sm" variant="secondary">
            {formData.button_text || "Submit Feedback"}
          </Button>
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
