import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2, BarChart3, Plus, Trash2, Clock, Car, Crown, Star, Shield, Phone, Check, Lock } from "lucide-react";

interface StatItem {
  icon: string;
  label: string;
  value: string;
  suffix?: string;
  use_dynamic?: boolean;
  dynamic_source?: string;
}

interface StatsContent {
  items: StatItem[];
}

interface StatsEditorProps {
  content: StatsContent;
  onSave: (content: StatsContent) => void;
  isSaving: boolean;
}

const AVAILABLE_ICONS = [
  { value: "clock", label: "Clock", icon: Clock },
  { value: "car", label: "Car", icon: Car },
  { value: "crown", label: "Crown", icon: Crown },
  { value: "star", label: "Star", icon: Star },
  { value: "shield", label: "Shield", icon: Shield },
  { value: "phone", label: "Phone", icon: Phone },
  { value: "check", label: "Check", icon: Check },
  { value: "lock", label: "Lock", icon: Lock },
];

const DYNAMIC_SOURCES = [
  { value: "years_experience", label: "Years in Business (calculated from founded year)" },
  { value: "total_rentals", label: "Total Rentals (from database)" },
  { value: "active_vehicles", label: "Active Vehicles (from database)" },
  { value: "avg_rating", label: "Average Rating (from testimonials)" },
];

const getIconComponent = (iconName: string) => {
  const iconItem = AVAILABLE_ICONS.find(i => i.value === iconName);
  if (iconItem) {
    const IconComponent = iconItem.icon;
    return <IconComponent className="h-5 w-5 text-accent" />;
  }
  return <Clock className="h-5 w-5 text-accent" />;
};

export function StatsEditor({ content, onSave, isSaving }: StatsEditorProps) {
  const [formData, setFormData] = useState<StatsContent>(content);

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
        { icon: "star", label: "", value: "", suffix: "+", use_dynamic: false },
      ],
    });
  };

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const updateItem = (index: number, field: keyof StatItem, value: string | boolean) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent" />
          Stats Section
        </CardTitle>
        <CardDescription>
          Manage the statistics cards displayed on the About page. You can use dynamic values from the database or set custom values.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Stat Items</Label>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" />
              Add Stat
            </Button>
          </div>

          {formData.items.map((item, index) => (
            <Card key={index} className="p-4 bg-muted/30">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {getIconComponent(item.icon)}
                    <span className="font-medium">Stat #{index + 1}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
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

                  <div className="space-y-2">
                    <Label className="text-xs">Label (displayed below value)</Label>
                    <Input
                      value={item.label}
                      onChange={(e) => updateItem(index, "label", e.target.value)}
                      placeholder="e.g., YEARS EXPERIENCE"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={item.use_dynamic || false}
                    onCheckedChange={(checked) => updateItem(index, "use_dynamic", checked)}
                  />
                  <Label className="text-sm">Use dynamic value from database</Label>
                </div>

                {item.use_dynamic ? (
                  <div className="space-y-2">
                    <Label className="text-xs">Dynamic Source</Label>
                    <Select
                      value={item.dynamic_source || ""}
                      onValueChange={(value) => updateItem(index, "dynamic_source", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select data source" />
                      </SelectTrigger>
                      <SelectContent>
                        {DYNAMIC_SOURCES.map((source) => (
                          <SelectItem key={source.value} value={source.value}>
                            {source.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs">Value</Label>
                      <Input
                        value={item.value}
                        onChange={(e) => updateItem(index, "value", e.target.value)}
                        placeholder="e.g., 15, 5000, 5.0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Suffix (optional)</Label>
                      <Input
                        value={item.suffix || ""}
                        onChange={(e) => updateItem(index, "suffix", e.target.value)}
                        placeholder="e.g., +, %, K"
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}

          {formData.items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              No stats yet. Click "Add Stat" to create your first statistic.
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-3">Preview</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {formData.items.map((item, index) => (
              <div key={index} className="text-center p-4 border rounded-lg bg-card">
                <div className="flex justify-center mb-2">
                  <div className="p-2 rounded-full bg-accent/10 border border-accent/20">
                    {getIconComponent(item.icon)}
                  </div>
                </div>
                <div className="text-2xl font-bold text-accent">
                  {item.use_dynamic ? (
                    <span className="text-muted-foreground italic text-sm">Dynamic</span>
                  ) : (
                    <>
                      {item.value || "0"}{item.suffix || ""}
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
                  {item.label || "Label"}
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
