import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, Plus, Trash2, GripVertical, ChevronUp, ChevronDown, ListOrdered } from "lucide-react";
import type { HowItWorksContent, HowItWorksStep } from "@/types/cms";

interface HowItWorksEditorProps {
  content: HowItWorksContent;
  onSave: (content: HowItWorksContent) => void;
  isSaving: boolean;
}

const defaultStep: HowItWorksStep = {
  number: "1",
  title: "",
  description: "",
};

const formSchema = z.object({
  title: z.string().min(1, "Section title is required"),
  subtitle: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function HowItWorksEditor({ content, onSave, isSaving }: HowItWorksEditorProps) {
  const [steps, setSteps] = useState<HowItWorksStep[]>(content.steps || []);

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
    setSteps(content.steps || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      steps,
    });
  };

  const addStep = () => {
    const newNumber = (steps.length + 1).toString();
    setSteps([...steps, { ...defaultStep, number: newNumber }]);
  };

  const removeStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    const renumberedSteps = newSteps.map((step, i) => ({
      ...step,
      number: (i + 1).toString(),
    }));
    setSteps(renumberedSteps);
  };

  const updateStep = (index: number, field: keyof HowItWorksStep, value: string) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newSteps = [...steps];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newSteps.length) return;

    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    const renumberedSteps = newSteps.map((step, i) => ({
      ...step,
      number: (i + 1).toString(),
    }));
    setSteps(renumberedSteps);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5 text-accent" />
              How It Works Section
            </CardTitle>
            <CardDescription>
              Edit the step-by-step guide explaining how promotions work
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Section Header */}
            <div className="grid gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section Title</FormLabel>
                    <FormControl>
                      <Input placeholder="How Promotions Work" {...field} />
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
                      <Input placeholder="Simple steps to save on your luxury car rental" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Steps */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel className="text-base font-semibold">Steps</FormLabel>
                <Button type="button" variant="outline" size="sm" onClick={addStep}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Step
                </Button>
              </div>

              {steps.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                  <ListOrdered className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No steps added yet. Click "Add Step" to create one.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {steps.map((step, index) => (
                    <Card key={index} className="p-4 bg-muted/30">
                      <div className="flex gap-3">
                        <div className="flex flex-col gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => moveStep(index, "up")}
                            disabled={index === 0}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <GripVertical className="h-5 w-5 text-muted-foreground mx-auto" />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => moveStep(index, "down")}
                            disabled={index === steps.length - 1}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-lg font-bold text-accent">{step.number}</span>
                            </div>
                            <Input
                              value={step.title}
                              onChange={(e) => updateStep(index, "title", e.target.value)}
                              placeholder="Step title"
                              className="flex-1"
                            />
                          </div>
                          <Textarea
                            value={step.description}
                            onChange={(e) => updateStep(index, "description", e.target.value)}
                            placeholder="Step description"
                            rows={2}
                          />
                        </div>

                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removeStep(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
