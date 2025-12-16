import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, CheckCircle, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { InclusionsContent, ServiceInclusion } from "@/types/cms";

interface InclusionsEditorProps {
  content: InclusionsContent;
  onSave: (content: InclusionsContent) => void;
  isSaving: boolean;
}

const iconOptions = [
  { value: "Shield", label: "Shield" },
  { value: "Phone", label: "Phone" },
  { value: "MapPin", label: "Map Pin" },
  { value: "Fuel", label: "Fuel" },
  { value: "User", label: "User" },
  { value: "Sparkles", label: "Sparkles" },
  { value: "Plane", label: "Plane" },
  { value: "Clock", label: "Clock" },
  { value: "Car", label: "Car" },
  { value: "Crown", label: "Crown" },
  { value: "Wifi", label: "WiFi" },
  { value: "Baby", label: "Baby" },
  { value: "FileCheck", label: "File Check" },
  { value: "Wrench", label: "Wrench" },
];

const formSchema = z.object({
  section_title: z.string().min(1, "Section title is required"),
  section_subtitle: z.string().optional(),
  standard_title: z.string().min(1, "Standard section title is required"),
  premium_title: z.string().min(1, "Premium section title is required"),
});

type FormValues = z.infer<typeof formSchema>;

export function InclusionsEditor({ content, onSave, isSaving }: InclusionsEditorProps) {
  const [standardItems, setStandardItems] = useState<ServiceInclusion[]>(content.standard_items || []);
  const [premiumItems, setPremiumItems] = useState<ServiceInclusion[]>(content.premium_items || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      section_title: content.section_title || "",
      section_subtitle: content.section_subtitle || "",
      standard_title: content.standard_title || "",
      premium_title: content.premium_title || "",
    },
  });

  useEffect(() => {
    form.reset({
      section_title: content.section_title || "",
      section_subtitle: content.section_subtitle || "",
      standard_title: content.standard_title || "",
      premium_title: content.premium_title || "",
    });
    setStandardItems(content.standard_items || []);
    setPremiumItems(content.premium_items || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      standard_items: standardItems,
      premium_items: premiumItems,
    });
  };

  const addItem = (type: "standard" | "premium") => {
    const newItem: ServiceInclusion = { icon: "Shield", title: "" };
    if (type === "standard") {
      setStandardItems([...standardItems, newItem]);
    } else {
      setPremiumItems([...premiumItems, newItem]);
    }
  };

  const removeItem = (type: "standard" | "premium", index: number) => {
    if (type === "standard") {
      setStandardItems(standardItems.filter((_, i) => i !== index));
    } else {
      setPremiumItems(premiumItems.filter((_, i) => i !== index));
    }
  };

  const updateItem = (type: "standard" | "premium", index: number, field: keyof ServiceInclusion, value: string) => {
    if (type === "standard") {
      const items = [...standardItems];
      items[index] = { ...items[index], [field]: value };
      setStandardItems(items);
    } else {
      const items = [...premiumItems];
      items[index] = { ...items[index], [field]: value };
      setPremiumItems(items);
    }
  };

  const moveItem = (type: "standard" | "premium", index: number, direction: "up" | "down") => {
    const items = type === "standard" ? [...standardItems] : [...premiumItems];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    [items[index], items[newIndex]] = [items[newIndex], items[index]];
    if (type === "standard") {
      setStandardItems(items);
    } else {
      setPremiumItems(items);
    }
  };

  const renderItemList = (type: "standard" | "premium", items: ServiceInclusion[], titleFieldName: "standard_title" | "premium_title") => (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name={titleFieldName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{type === "standard" ? "Standard" : "Premium"} Section Title</FormLabel>
            <FormControl>
              <Input placeholder={type === "standard" ? "Standard Inclusions" : "Premium Add-ons"} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex items-center justify-between">
        <FormLabel className="text-sm font-medium">Items</FormLabel>
        <Button type="button" variant="outline" size="sm" onClick={() => addItem(type)}>
          <Plus className="h-4 w-4 mr-1" /> Add Item
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 border-2 border-dashed rounded-lg">
          No items yet. Click "Add Item" to create one.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
              <div className="flex flex-col gap-0.5">
                <Button type="button" size="icon" variant="ghost" className="h-5 w-5" onClick={() => moveItem(type, index, "up")} disabled={index === 0}>
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-5 w-5" onClick={() => moveItem(type, index, "down")} disabled={index === items.length - 1}>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
              <Select value={item.icon} onValueChange={(v) => updateItem(type, index, "icon", v)}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {iconOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={item.title}
                onChange={(e) => updateItem(type, index, "title", e.target.value)}
                placeholder="Item title"
                className="flex-1"
              />
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeItem(type, index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-accent" />
              Service Inclusions
            </CardTitle>
            <CardDescription>
              Edit what's included with every rental - standard and premium services
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="section_title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Every Drive917 Rental Includes" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="section_subtitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section Subtitle</FormLabel>
                    <FormControl>
                      <Input placeholder="Peace of mind and premium service come standard..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-4">
                {renderItemList("standard", standardItems, "standard_title")}
              </Card>
              <Card className="p-4">
                {renderItemList("premium", premiumItems, "premium_title")}
              </Card>
            </div>

            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
