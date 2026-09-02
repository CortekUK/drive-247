import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Plus, X } from "lucide-react";
import type { ContactFormContent } from "@/types/cms";

const contactFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  subtitle: z.string().min(1, "Subtitle is required").max(200),
  success_message: z.string().min(1, "Success message is required").max(500),
  gdpr_text: z.string().min(1, "GDPR text is required").max(300),
  submit_button_text: z.string().min(1, "Button text is required").max(50),
  subject_options: z.array(z.string().min(1)).min(1, "At least one subject option is required"),
});

interface ContactFormEditorProps {
  content: ContactFormContent;
  onSave: (content: ContactFormContent) => void;
  isSaving: boolean;
}

export function ContactFormEditor({ content, onSave, isSaving }: ContactFormEditorProps) {
  const form = useForm<ContactFormContent>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      ...content,
      subject_options: content.subject_options?.length > 0 ? content.subject_options : [""],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "subject_options" as any,
  });

  const handleSubmit = (data: ContactFormContent) => {
    // Filter out empty subject options
    const cleanedData = {
      ...data,
      subject_options: data.subject_options.filter((s) => s.trim() !== ""),
    };
    onSave(cleanedData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact Form Settings</CardTitle>
        <CardDescription>
          Configure the contact form labels, messages, and subject dropdown options
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Form Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Send Us a Message" />
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
                  <FormLabel>Form Subtitle</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="We typically reply within 2 hours..." />
                  </FormControl>
                  <FormDescription>Short text displayed below the form title</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="success_message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Success Message</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Thank you for contacting Drive247. Our concierge team will respond..."
                    />
                  </FormControl>
                  <FormDescription>Message shown after form submission</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="gdpr_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GDPR Consent Text</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder="I consent to being contacted regarding my enquiry."
                    />
                  </FormControl>
                  <FormDescription>Text for the consent checkbox</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="submit_button_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Submit Button Text</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Send Message" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Subject Options */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <FormLabel>Subject Options</FormLabel>
                  <p className="text-sm text-muted-foreground">
                    Dropdown options for the subject field
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append("")}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Option
                </Button>
              </div>

              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex gap-2">
                    <FormField
                      control={form.control}
                      name={`subject_options.${index}`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input {...field} placeholder={`Option ${index + 1}`} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Section
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
