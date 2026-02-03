import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Smartphone } from "lucide-react";

interface PWAInstallContent {
  title: string;
  description: string;
}

interface PWAInstallEditorProps {
  content: PWAInstallContent;
  onSave: (content: PWAInstallContent) => void;
  isSaving: boolean;
}

export function PWAInstallEditor({ content, onSave, isSaving }: PWAInstallEditorProps) {
  const [formData, setFormData] = useState<PWAInstallContent>(content);

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
          <Smartphone className="h-5 w-5 text-accent" />
          PWA Install Section
        </CardTitle>
        <CardDescription>
          Customize the app installation prompt shown on the Contact page
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="pwa-title">Title</Label>
          <Input
            id="pwa-title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Install Drive247"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pwa-description">Description</Label>
          <Textarea
            id="pwa-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Scan the QR code to add Drive247 to your home screen..."
            rows={3}
          />
        </div>

        {/* Preview */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-2">Preview</p>
          <h3 className="text-xl font-display font-bold mb-1">
            {formData.title || "Install Drive247"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {formData.description || "Scan the QR code to add Drive247 to your home screen for fast, seamless bookings in Los Angeles and beyond."}
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
