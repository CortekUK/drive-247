import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, Phone } from "lucide-react";
import type { ContactCardContent } from "@/types/cms";

interface ContactCardEditorProps {
  content: ContactCardContent;
  onSave: (content: ContactCardContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  title: z.string().min(1, "Card title is required"),
  description: z.string().optional(),
  phone_number: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  call_button_text: z.string().optional(),
  email_button_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function ContactCardEditor({ content, onSave, isSaving }: ContactCardEditorProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: content.title || "",
      description: content.description || "",
      phone_number: content.phone_number || "",
      email: content.email || "",
      call_button_text: content.call_button_text || "",
      email_button_text: content.email_button_text || "",
    },
  });

  useEffect(() => {
    form.reset({
      title: content.title || "",
      description: content.description || "",
      phone_number: content.phone_number || "",
      email: content.email || "",
      call_button_text: content.call_button_text || "",
      email_button_text: content.email_button_text || "",
    });
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave(data as ContactCardContent);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-accent" />
              Contact Card
            </CardTitle>
            <CardDescription>
              The "Have Questions?" contact card section
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Card Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Have Questions About Your Rental?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="We're here to help 7 days a week..."
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
              <FormLabel className="text-base font-semibold">Contact Details</FormLabel>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="phone_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+19725156635" {...field} />
                      </FormControl>
                      <FormDescription>Include country code for tel: link</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="info@drive917.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <FormLabel className="text-base font-semibold">Button Labels</FormLabel>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="call_button_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Call Button Text</FormLabel>
                      <FormControl>
                        <Input placeholder="Call Now" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email_button_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Button Text</FormLabel>
                      <FormControl>
                        <Input placeholder="Email Us" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
