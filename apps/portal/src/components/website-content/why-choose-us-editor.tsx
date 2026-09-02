import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Award, Plus, Trash2, GripVertical, Lock, Crown, Shield, Clock, Star, Car, Phone, Check } from "lucide-react";

interface WhyChooseUsItem {
  icon: string;
  title: string;
  description: string;
}

interface WhyChooseUsContent {
  title: string;
  items: WhyChooseUsItem[];
}

interface WhyChooseUsEditorProps {
  content: WhyChooseUsContent;
  onSave: (content: WhyChooseUsContent) => void;
  isSaving: boolean;
}

const AVAILABLE_ICONS = [
  { value: "lock", label: "Lock", icon: Lock },
  { value: "crown", label: "Crown", icon: Crown },
  { value: "shield", label: "Shield", icon: Shield },
  { value: "clock", label: "Clock", icon: Clock },
  { value: "star", label: "Star", icon: Star },
  { value: "car", label: "Car", icon: Car },
  { value: "phone", label: "Phone", icon: Phone },
  { value: "check", label: "Check", icon: Check },
];

const getIconComponent = (iconName: string) => {
  const iconItem = AVAILABLE_ICONS.find(i => i.value === iconName);
  if (iconItem) {
    const IconComponent = iconItem.icon;
    return <IconComponent className="h-5 w-5 text-accent" />;
  }
  return <Shield className="h-5 w-5 text-accent" />;
};

export function WhyChooseUsEditor({ content, onSave, isSaving }: WhyChooseUsEditorProps) {
  const [formData, setFormData] = useState<WhyChooseUsContent>(content);

  useEffect(() => {
    setFormData(content);
  }, [content]);

  const handleSave = () => {
    onSave(formData);
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        { icon: "shield", title: "", description: "" },
      ],
    });
  };

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const updateItem = (index: number, field: keyof WhyChooseUsItem, value: string) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-accent" />
          Why Choose Us Section
        </CardTitle>
        <CardDescription>
          Manage the "Why Choose Us" feature cards on the About page
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="section-title">Section Title</Label>
          <Input
            id="section-title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Why Choose Us"
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Feature Items</Label>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>

          {formData.items.map((item, index) => (
            <Card key={index} className="p-4 bg-muted/30">
              <div className="flex items-start gap-3">
                <div className="mt-6 text-muted-foreground">
                  <GripVertical className="h-5 w-5" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Icon</Label>
                      <Select
                        value={item.icon}
                        onValueChange={(value) => updateItem(index, "icon", value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_ICONS.map((iconOption) => (
                            <SelectItem key={iconOption.value} value={iconOption.value}>
                              <div className="flex items-center gap-2">
                                <iconOption.icon className="h-4 w-4" />
                                {iconOption.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <Label className="text-xs">Title</Label>
                      <Input
                        value={item.title}
                        onChange={(e) => updateItem(index, "title", e.target.value)}
                        placeholder="Feature title"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={item.description}
                      onChange={(e) => updateItem(index, "description", e.target.value)}
                      placeholder="Feature description..."
                      rows={2}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive mt-6"
                  onClick={() => removeItem(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}

          {formData.items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              No items yet. Click "Add Item" to create your first feature.
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-3">Preview</p>
          <h3 className="text-xl font-display font-bold mb-4">
            {formData.title || "Why Choose Us"}
          </h3>
          <div className="space-y-3">
            {formData.items.map((item, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-accent/10 border border-accent/20">
                  {getIconComponent(item.icon)}
                </div>
                <div>
                  <h4 className="font-semibold text-sm">{item.title || "Feature Title"}</h4>
                  <p className="text-xs text-muted-foreground">{item.description || "Feature description"}</p>
                </div>
              </div>
            ))}
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
