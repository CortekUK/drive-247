import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, Sparkles, Plus, Trash2, GripVertical } from "lucide-react";
import type { ServiceHighlightsContent, ServiceHighlightItem } from "@/types/cms";

const AVAILABLE_ICONS = [
  { value: "ThumbsUp", label: "Thumbs Up" },
  { value: "Users", label: "Users" },
  { value: "MapPin", label: "Map Pin" },
  { value: "Baby", label: "Baby" },
  { value: "Settings", label: "Settings" },
  { value: "Headphones", label: "Headphones" },
  { value: "Shield", label: "Shield" },
  { value: "Car", label: "Car" },
  { value: "Clock", label: "Clock" },
  { value: "Phone", label: "Phone" },
  { value: "Star", label: "Star" },
  { value: "Award", label: "Award" },
  { value: "CheckCircle", label: "Check Circle" },
  { value: "Fuel", label: "Fuel" },
  { value: "Wifi", label: "WiFi" },
  { value: "Crown", label: "Crown" },
];

interface ServiceHighlightsEditorProps {
  content: ServiceHighlightsContent;
  onSave: (content: ServiceHighlightsContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  title: z.string().min(1, "Section title is required"),
  subtitle: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function ServiceHighlightsEditor({ content, onSave, isSaving }: ServiceHighlightsEditorProps) {
  const [services, setServices] = useState<ServiceHighlightItem[]>(content.services || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: content.title || "",
      subtitle: content.subtitle || "",
    },
  });

  useEffect(() => {
    form.reset({
      title: content.title || "",
      subtitle: content.subtitle || "",
    });
    setServices(content.services || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      services,
    });
  };

  const addService = () => {
    setServices([
      ...services,
      { icon: "ThumbsUp", title: "", description: "" },
    ]);
  };

  const updateService = (index: number, field: keyof ServiceHighlightItem, value: string) => {
    const updated = [...services];
    updated[index] = { ...updated[index], [field]: value };
    setServices(updated);
  };

  const removeService = (index: number) => {
    setServices(services.filter((_, i) => i !== index));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" />
              Service Highlights
            </CardTitle>
            <CardDescription>
              The "Why Choose Drive917" section with service cards
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Why Choose Drive917" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subtitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section Subtitle</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Delivering excellence through premium vehicle rentals..."
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <FormLabel className="text-base font-semibold">Service Cards</FormLabel>
                  <p className="text-sm text-muted-foreground">Add and edit the service highlight cards</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addService}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Service
                </Button>
              </div>

              <div className="space-y-4">
                {services.map((service, index) => (
                  <Card key={index} className="p-4 bg-muted/30">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">Service {index + 1}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeService(index)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FormLabel>Icon</FormLabel>
                          <Select
                            value={service.icon}
                            onValueChange={(value) => updateService(index, "icon", value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select icon" />
                            </SelectTrigger>
                            <SelectContent>
                              {AVAILABLE_ICONS.map((icon) => (
                                <SelectItem key={icon.value} value={icon.value}>
                                  {icon.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <FormLabel>Title</FormLabel>
                          <Input
                            value={service.title}
                            onChange={(e) => updateService(index, "title", e.target.value)}
                            placeholder="Service title"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <FormLabel>Description</FormLabel>
                        <Textarea
                          value={service.description}
                          onChange={(e) => updateService(index, "description", e.target.value)}
                          placeholder="Service description..."
                          rows={3}
                        />
                      </div>
                    </div>
                  </Card>
                ))}
                {services.length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    No services added yet. Click "Add Service" to create one.
                  </p>
                )}
              </div>
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
