import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, DollarSign, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { ExtrasContent, PricingExtra } from "@/types/cms";

interface ExtrasEditorProps {
  content: ExtrasContent;
  onSave: (content: ExtrasContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  footer_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function ExtrasEditor({ content, onSave, isSaving }: ExtrasEditorProps) {
  const [items, setItems] = useState<PricingExtra[]>(content.items || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      footer_text: content.footer_text || "",
    },
  });

  useEffect(() => {
    form.reset({
      footer_text: content.footer_text || "",
    });
    setItems(content.items || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      items,
    } as ExtrasContent);
  };

  const addExtra = () => {
    setItems([...items, { name: "", price: 0, description: "" }]);
  };

  const removeExtra = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateExtra = (index: number, field: keyof PricingExtra, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const moveExtra = (index: number, direction: "up" | "down") => {
    const newItems = [...items];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newItems.length) return;
    [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];
    setItems(newItems);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-accent" />
              Pricing Extras
            </CardTitle>
            <CardDescription>
              Manage additional services and their prices
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <FormLabel className="text-base font-semibold">Extra Services</FormLabel>
              <Button type="button" variant="outline" size="sm" onClick={addExtra}>
                <Plus className="h-4 w-4 mr-1" /> Add Extra
              </Button>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No extras yet. Click "Add Extra" to create one.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((extra, index) => (
                  <Card key={index} className="p-4 bg-muted/30">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col gap-0.5">
                        <Button type="button" size="icon" variant="ghost" className="h-5 w-5" onClick={() => moveExtra(index, "up")} disabled={index === 0}>
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-5 w-5" onClick={() => moveExtra(index, "down")} disabled={index === items.length - 1}>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex-1 grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <FormLabel className="text-xs">Name</FormLabel>
                          <Input
                            value={extra.name}
                            onChange={(e) => updateExtra(index, "name", e.target.value)}
                            placeholder="Child Safety Seat"
                          />
                        </div>
                        <div className="space-y-1">
                          <FormLabel className="text-xs">Price ($)</FormLabel>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={extra.price}
                            onChange={(e) => updateExtra(index, "price", parseFloat(e.target.value) || 0)}
                            placeholder="15"
                          />
                        </div>
                        <div className="space-y-1">
                          <FormLabel className="text-xs">Description</FormLabel>
                          <Input
                            value={extra.description}
                            onChange={(e) => updateExtra(index, "description", e.target.value)}
                            placeholder="Per day"
                          />
                        </div>
                      </div>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeExtra(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <FormField
              control={form.control}
              name="footer_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Footer Text</FormLabel>
                  <FormControl>
                    <Input placeholder="All add-ons can be selected and customized during booking." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
