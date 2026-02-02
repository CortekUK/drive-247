import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import type { ContactInfoContent } from "@/types/cms";

const contactInfoSchema = z.object({
  phone: z.object({
    number: z.string().min(1, "Phone number is required"),
    availability: z.string().min(1, "Availability text is required"),
  }),
  email: z.object({
    address: z.string().email("Invalid email address"),
    response_time: z.string().min(1, "Response time text is required"),
  }),
  office: z.object({
    address: z.string().min(1, "Office address is required"),
  }),
  whatsapp: z.object({
    number: z.string().min(1, "WhatsApp number is required"),
    description: z.string().min(1, "WhatsApp description is required"),
  }),
});

interface ContactInfoEditorProps {
  content: ContactInfoContent;
  onSave: (content: ContactInfoContent) => void;
  isSaving: boolean;
}

export function ContactInfoEditor({ content, onSave, isSaving }: ContactInfoEditorProps) {
  const form = useForm<ContactInfoContent>({
    resolver: zodResolver(contactInfoSchema),
    defaultValues: content,
  });

  const handleSubmit = (data: ContactInfoContent) => {
    onSave(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact Information</CardTitle>
        <CardDescription>
          Phone, email, address, and WhatsApp details shown on the Contact page
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
            {/* Phone Section */}
            <div className="space-y-4 p-4 border rounded-lg">
              <div className="flex items-center gap-2 text-primary">
                <Phone className="h-5 w-5" />
                <h3 className="font-semibold">Phone</h3>
              </div>

              <FormField
                control={form.control}
                name="phone.number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+44 800 123 4567" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone.availability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Availability Text</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="24 hours a day, 7 days a week, 365 days a year" />
                    </FormControl>
                    <FormDescription>Text shown below the phone number</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Email Section */}
            <div className="space-y-4 p-4 border rounded-lg">
              <div className="flex items-center gap-2 text-primary">
                <Mail className="h-5 w-5" />
                <h3 className="font-semibold">Email</h3>
              </div>

              <FormField
                control={form.control}
                name="email.address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="info@drive247.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email.response_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Response Time Text</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Response within 2 hours during business hours (PST)" />
                    </FormControl>
                    <FormDescription>Text shown below the email address</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Office Section */}
            <div className="space-y-4 p-4 border rounded-lg">
              <div className="flex items-center gap-2 text-primary">
                <MapPin className="h-5 w-5" />
                <h3 className="font-semibold">Office</h3>
              </div>

              <FormField
                control={form.control}
                name="office.address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Office Address</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} placeholder="123 Luxury Lane, London, UK" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* WhatsApp Section */}
            <div className="space-y-4 p-4 border rounded-lg">
              <div className="flex items-center gap-2 text-primary">
                <MessageCircle className="h-5 w-5" />
                <h3 className="font-semibold">WhatsApp</h3>
              </div>

              <FormField
                control={form.control}
                name="whatsapp.number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="+447900123456" />
                    </FormControl>
                    <FormDescription>Include country code without spaces</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="whatsapp.description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp Description</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Quick response for urgent enquiries" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
