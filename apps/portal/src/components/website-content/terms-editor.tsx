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
import { Loader2, Save, Plus, Trash2, ChevronUp, ChevronDown, FileText } from "lucide-react";
import type { TermsContent } from "@/types/cms";

interface TermsEditorProps {
  content: TermsContent;
  onSave: (content: TermsContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  title: z.string().min(1, "Section title is required"),
});

type FormValues = z.infer<typeof formSchema>;

export function TermsEditor({ content, onSave, isSaving }: TermsEditorProps) {
  const [terms, setTerms] = useState<string[]>(content.terms || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: content.title || "",
    },
  });

  useEffect(() => {
    form.reset({
      title: content.title || "",
    });
    setTerms(content.terms || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      terms,
    });
  };

  const addTerm = () => {
    setTerms([...terms, ""]);
  };

  const removeTerm = (index: number) => {
    setTerms(terms.filter((_, i) => i !== index));
  };

  const updateTerm = (index: number, value: string) => {
    const newTerms = [...terms];
    newTerms[index] = value;
    setTerms(newTerms);
  };

  const moveTerm = (index: number, direction: "up" | "down") => {
    const newTerms = [...terms];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newTerms.length) return;

    [newTerms[index], newTerms[newIndex]] = [newTerms[newIndex], newTerms[index]];
    setTerms(newTerms);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              Terms & Conditions Section
            </CardTitle>
            <CardDescription>
              Edit the terms and conditions displayed on the promotions page
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Terms & Conditions" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel className="text-base font-semibold">Terms</FormLabel>
                <Button type="button" variant="outline" size="sm" onClick={addTerm}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Term
                </Button>
              </div>

              {terms.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No terms added yet. Click "Add Term" to create one.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {terms.map((term, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          onClick={() => moveTerm(index, "up")}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          onClick={() => moveTerm(index, "down")}
                          disabled={index === terms.length - 1}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <span className="text-muted-foreground w-4">•</span>
                      <Input
                        value={term}
                        onChange={(e) => updateTerm(index, e.target.value)}
                        placeholder="Enter term"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeTerm(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
