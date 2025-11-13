import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Phone, Mail, MapPin, Clock, MessageCircle, CheckCircle, AlertCircle, Shield, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Link } from "react-router-dom";
import PWAInstall from "@/components/PWAInstall";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import SEO from "@/components/SEO";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Name must be less than 100 characters"),
  email: z.string().trim().email("Please enter a valid email address").max(255, "Email must be less than 255 characters"),
  phone: z.string().trim().refine((val) => {
    const cleaned = val.replace(/[\s\-()]/g, '');
    const digitCount = (cleaned.match(/\d/g) || []).length;
    return digitCount >= 7 && digitCount <= 15;
  }, "Please enter a valid phone number (7-15 digits)"),
  subject: z.enum(["General Enquiry", "Corporate Rental", "Vehicle Availability", "Partnerships"], {
    errorMap: () => ({ message: "Please select a subject" })
  }),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(2000, "Message must be less than 2000 characters"),
  gdprConsent: z.boolean().refine(val => val === true, "You must consent to being contacted"),
});

const Contact = () => {
  const { settings, isLoading: settingsLoading } = useSiteSettings();
  const [loading, setLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "General Enquiry",
    message: "",
    gdprConsent: false,
  });

  // LocalBusiness schema for SEO
  const businessSchema = {
    "@context": "https://schema.org",
    "@type": "CarRental",
    "name": "Drive917",
    "description": "Premium luxury car rentals in Los Angeles",
    "url": window.location.origin,
    "telephone": settings.phone,
    "email": settings.email,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "902 Melrose Avenue",
      "addressLocality": "Los Angeles",
      "addressRegion": "CA",
      "postalCode": "90069",
      "addressCountry": "US"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": "34.0837",
      "longitude": "-118.3688"
    },
    "openingHours": "Mo-Su 00:00-23:59",
    "priceRange": "$$$",
    "areaServed": {
      "@type": "City",
      "name": "Los Angeles"
    }
  };
  
  // Format phone number for tel: link (remove spaces and special chars except +)
  const phoneLink = settings.phone.replace(/[^\d+]/g, '');
  // Format WhatsApp number (remove all non-digits and add country code)
  const whatsappNumber = settings.whatsapp_number
    ? settings.whatsapp_number.replace(/[^\d]/g, '')
    : phoneLink;

  // Validate individual field
  const validateField = (fieldName: keyof typeof formData, value: any) => {
    try {
      const fieldSchema = contactSchema.shape[fieldName];
      fieldSchema.parse(value);
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        setErrors((prev) => ({
          ...prev,
          [fieldName]: error.errors[0].message,
        }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    setSubmitStatus('idle');

    try {
      // Validate form data
      contactSchema.parse(formData);

      // Send email to admin using dedicated contact form function
      const { error: emailError } = await supabase.functions.invoke('send-contact-email', {
        body: {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          subject: formData.subject,
          message: formData.message,
          adminEmail: 'ilyasghulam32@gmail.com'
        }
      });

      if (emailError) {
        throw emailError;
      }

      setSubmitStatus('success');
      toast.success("Thank you for contacting Drive917. Our concierge team will respond within 2 hours during business hours (PST).");

      // Reset form
      setFormData({
        name: "",
        email: "",
        phone: "",
        subject: "General Enquiry",
        message: "",
        gdprConsent: false,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            fieldErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(fieldErrors);
      } else {
        setSubmitStatus('error');
        toast.error("Something went wrong. Please try again.");
        console.error("Contact form error:", error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Contact Drive917 — Los Angeles Luxury Car Rentals"
        description="Get in touch with Drive917 for premium vehicle rentals, chauffeur services, and exclusive offers in Los Angeles."
        keywords="contact Drive917, luxury car rental Los Angeles, premium vehicle rental contact, chauffeur service inquiry"
        schema={businessSchema}
        canonical={`${window.location.origin}/contact`}
      />
      <Navigation />
      
      {/* Hero Section with Texture */}
      <section className="pt-32 pb-24 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-muted/40 to-background pointer-events-none" />
        <div className="container mx-auto px-4 relative">
          <div className="max-w-4xl mx-auto text-center mb-20 animate-fade-in">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-6 text-gradient-metal leading-tight">
              Contact Drive917
            </h1>
            <div className="flex items-center justify-center mb-8">
              <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Get in touch for premium vehicle rentals, chauffeur services, and exclusive offers in Los Angeles.
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="grid lg:grid-cols-2 gap-12 max-w-7xl mx-auto">
            {/* Left Column - Contact Info */}
            <div className="space-y-6 animate-fade-in animation-delay-200">
              {settingsLoading ? (
                <>
                  {[...Array(5)].map((_, i) => (
                    <Card key={i} className="p-6">
                      <div className="flex items-start gap-4">
                        <Skeleton className="w-12 h-12 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-6 w-24" />
                          <Skeleton className="h-5 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              ) : (
                <>
                  {/* Phone Card */}
                  <Card className="group p-6 shadow-metal bg-card/50 backdrop-blur border-t-2 border-t-accent/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-glow">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors flex-shrink-0">
                        <Phone className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-display font-semibold mb-2 text-gradient-silver">Phone</h3>
                        <a 
                          href={`tel:${phoneLink}`}
                          className="text-lg text-accent hover:underline block mb-2 font-medium"
                        >
                          {settings.phone}
                        </a>
                        <p className="text-sm text-muted-foreground">
                          {settings.availability}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Email Card */}
                  <Card className="group p-6 shadow-metal bg-card/50 backdrop-blur border-t-2 border-t-accent/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-glow">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors flex-shrink-0">
                        <Mail className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-display font-semibold mb-2 text-gradient-silver">Email</h3>
                        <a 
                          href={`mailto:${settings.email}`}
                          className="text-lg text-accent hover:underline block mb-2 font-medium break-all"
                        >
                          {settings.email}
                        </a>
                        <p className="text-sm text-muted-foreground">
                          Response within 2 hours during business hours (PST)
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Office Card */}
                  <Card className="group p-6 shadow-metal bg-card/50 backdrop-blur border-t-2 border-t-accent/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-glow">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors flex-shrink-0">
                        <MapPin className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-display font-semibold mb-2 text-gradient-silver">Office</h3>
                        <p className="text-muted-foreground leading-relaxed">
                          {settings.office_address}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Availability Card */}
                  <Card className="group p-6 shadow-metal bg-card/50 backdrop-blur border-t-2 border-t-accent/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-glow">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors flex-shrink-0">
                        <Clock className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-display font-semibold mb-2 text-gradient-silver">Availability</h3>
                        <p className="text-muted-foreground leading-relaxed">
                          {settings.availability}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* WhatsApp Button */}
                  <Card className="group p-6 shadow-metal bg-card/50 backdrop-blur border-t-2 border-t-accent/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-glow">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors flex-shrink-0">
                        <MessageCircle className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-display font-semibold mb-2 text-gradient-silver">WhatsApp</h3>
                        <a 
                          href={`https://wa.me/${whatsappNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-lg text-accent hover:underline block mb-2 font-medium"
                        >
                          Message us on WhatsApp
                        </a>
                        <p className="text-sm text-muted-foreground">
                          Quick response for urgent enquiries
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Trust Badges */}
                  <TooltipProvider>
                    <Card className="p-6 shadow-metal bg-gradient-to-br from-card via-secondary/20 to-card backdrop-blur border-accent/20">
                      <div className="flex items-center justify-around text-center gap-4">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex-1 cursor-help">
                              <Shield className="w-8 h-8 text-accent mx-auto mb-2" aria-label="Secure" />
                              <p className="text-xs text-muted-foreground font-medium">Secure</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Your data and booking details are encrypted and secure</p>
                          </TooltipContent>
                        </Tooltip>
                        <div className="h-10 w-[1px] bg-accent/20" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex-1 cursor-help">
                              <Lock className="w-8 h-8 text-accent mx-auto mb-2" aria-label="Confidential" />
                              <p className="text-xs text-muted-foreground font-medium">Confidential</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>All information is kept strictly confidential</p>
                          </TooltipContent>
                        </Tooltip>
                        <div className="h-10 w-[1px] bg-accent/20" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex-1 cursor-help">
                              <Clock className="w-8 h-8 text-accent mx-auto mb-2" aria-label="24/7 Support" />
                              <p className="text-xs text-muted-foreground font-medium">24/7 Support</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Our concierge team is available around the clock</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </Card>
                  </TooltipProvider>
                </>
              )}
            </div>

            {/* Right Column - Contact Form */}
            <Card className="p-8 lg:p-10 shadow-metal bg-card/50 backdrop-blur border-accent/20 animate-fade-in animation-delay-400">
              <h3 className="text-3xl font-display font-bold mb-2 dark:text-gradient-silver text-gradient-black">Send Us a Message</h3>
              <p className="text-sm text-muted-foreground mb-8">
                We typically reply within 2 hours during business hours.
              </p>
              
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Full Name */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-base">Full Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, name: value });
                      validateField('name', value);
                    }}
                    onBlur={() => validateField('name', formData.name)}
                    className={`${errors.name ? 'border-destructive focus-visible:ring-destructive' : ''} h-12`}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "name-error" : undefined}
                  />
                  {errors.name && (
                    <p id="name-error" className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="w-4 h-4" />
                      {errors.name}
                    </p>
                  )}
                </div>
                
                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-base">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, email: value });
                      validateField('email', value);
                    }}
                    onBlur={() => validateField('email', formData.email)}
                    className={`${errors.email ? 'border-destructive focus-visible:ring-destructive' : ''} h-12`}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "email-error" : undefined}
                  />
                  {errors.email && (
                    <p id="email-error" className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="w-4 h-4" />
                      {errors.email}
                    </p>
                  )}
                </div>
                
                {/* Phone */}
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-base">Phone Number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, phone: value });
                      validateField('phone', value);
                    }}
                    onBlur={() => validateField('phone', formData.phone)}
                    placeholder="Enter phone number"
                    className={`${errors.phone ? 'border-destructive focus-visible:ring-destructive' : ''} h-12`}
                    aria-invalid={!!errors.phone}
                    aria-describedby={errors.phone ? "phone-error" : undefined}
                  />
                  {errors.phone && (
                    <p id="phone-error" className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="w-4 h-4" />
                      {errors.phone}
                    </p>
                  )}
                </div>
                
                {/* Subject */}
                <div className="space-y-2">
                  <Label htmlFor="subject" className="text-base">Subject *</Label>
                  <Select
                    value={formData.subject}
                    onValueChange={(value) => {
                      setFormData({ ...formData, subject: value });
                      validateField('subject', value);
                    }}
                  >
                    <SelectTrigger 
                      id="subject"
                      className={`${errors.subject ? 'border-destructive focus-visible:ring-destructive' : ''} h-12`}
                      aria-invalid={!!errors.subject}
                      aria-describedby={errors.subject ? "subject-error" : undefined}
                    >
                      <SelectValue placeholder="Select a subject" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="General Enquiry">General Enquiry</SelectItem>
                      <SelectItem value="Corporate Rental">Corporate Rental</SelectItem>
                      <SelectItem value="Vehicle Availability">Vehicle Availability</SelectItem>
                      <SelectItem value="Partnerships">Partnerships</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.subject && (
                    <p id="subject-error" className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="w-4 h-4" />
                      {errors.subject}
                    </p>
                  )}
                </div>
                
                {/* Message */}
                <div className="space-y-2">
                  <Label htmlFor="message" className="text-base">Message *</Label>
                  <Textarea
                    id="message"
                    value={formData.message}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, message: value });
                      validateField('message', value);
                    }}
                    onBlur={() => validateField('message', formData.message)}
                    rows={5}
                    className={`${errors.message ? 'border-destructive focus-visible:ring-destructive' : ''} min-h-[120px]`}
                    aria-invalid={!!errors.message}
                    aria-describedby={errors.message ? "message-error" : undefined}
                  />
                  {errors.message && (
                    <p id="message-error" className="text-sm text-destructive flex items-center gap-1" role="alert">
                      <AlertCircle className="w-4 h-4" />
                      {errors.message}
                    </p>
                  )}
                </div>

                {/* GDPR Consent */}
                <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-accent/20">
                  <Checkbox
                    id="gdprConsent"
                    checked={formData.gdprConsent}
                    onCheckedChange={(checked) => {
                      const value = checked as boolean;
                      setFormData({ ...formData, gdprConsent: value });
                      validateField('gdprConsent', value);
                    }}
                    className={`${errors.gdprConsent ? 'border-destructive' : ''} mt-1`}
                    aria-invalid={!!errors.gdprConsent}
                    aria-describedby={errors.gdprConsent ? "gdpr-error" : undefined}
                  />
                  <div className="flex-1 space-y-1">
                    <Label
                      htmlFor="gdprConsent"
                      className="text-sm cursor-pointer leading-relaxed font-normal block"
                    >
                      I consent to being contacted regarding my enquiry. *
                    </Label>
                    {errors.gdprConsent && (
                      <p id="gdpr-error" className="text-sm text-destructive flex items-center gap-1" role="alert">
                        <AlertCircle className="w-4 h-4" />
                        {errors.gdprConsent}
                      </p>
                    )}
                  </div>
                </div>

                {/* Privacy Note */}
                <p className="text-xs text-muted-foreground">
                  Your data is handled in accordance with our{' '}
                  <Link to="/privacy" className="text-accent hover:underline">
                    Privacy Policy
                  </Link>
                  . We never share your information with third parties.
                </p>

                {/* Error State */}
                {submitStatus === 'error' && (
                  <div 
                    className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-3"
                    role="alert"
                    aria-live="polite"
                  >
                    <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-destructive mb-1">Something went wrong</p>
                      <p className="text-sm text-muted-foreground">
                        Please try again or contact us directly by phone or email.
                      </p>
                    </div>
                  </div>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full h-14 text-base shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all"
                  disabled={loading}
                >
                  {loading ? "Sending..." : "Send Message"}
                </Button>
              </form>
            </Card>
          </div>
        </div>
      </section>

      <PWAInstall />

      <Footer />
    </div>
  );
};

export default Contact;
