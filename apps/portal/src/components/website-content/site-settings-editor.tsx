import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Image, Phone, Mail, MapPin, Globe } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogoUploadWithResize } from "./logo-upload-with-resize";
import type { LogoContent, SiteContactContent, SocialLinksContent, FooterContent } from "@/types/cms";

interface SiteSettingsEditorProps {
  logo: LogoContent;
  contact: SiteContactContent;
  social: SocialLinksContent;
  footer: FooterContent;
  onSaveLogo: (content: LogoContent) => void;
  onSaveContact: (content: SiteContactContent) => void;
  onSaveSocial: (content: SocialLinksContent) => void;
  onSaveFooter: (content: FooterContent) => void;
  isSaving: boolean;
}

export function SiteSettingsEditor({
  logo,
  contact,
  social,
  footer,
  onSaveLogo,
  onSaveContact,
  onSaveSocial,
  onSaveFooter,
  isSaving,
}: SiteSettingsEditorProps) {
  const [logoData, setLogoData] = useState<LogoContent>(logo);
  const [contactData, setContactData] = useState<SiteContactContent>(contact);
  const [socialData, setSocialData] = useState<SocialLinksContent>(social);
  const [footerData, setFooterData] = useState<FooterContent>(footer);

  // Track previous prop values by JSON to avoid resetting local state on unstable references
  const prevLogoJson = useRef(JSON.stringify(logo));
  const prevContactJson = useRef(JSON.stringify(contact));
  const prevSocialJson = useRef(JSON.stringify(social));
  const prevFooterJson = useRef(JSON.stringify(footer));

  useEffect(() => {
    const logoJson = JSON.stringify(logo);
    if (logoJson !== prevLogoJson.current) {
      prevLogoJson.current = logoJson;
      setLogoData(logo);
    }
    const contactJson = JSON.stringify(contact);
    if (contactJson !== prevContactJson.current) {
      prevContactJson.current = contactJson;
      setContactData(contact);
    }
    const socialJson = JSON.stringify(social);
    if (socialJson !== prevSocialJson.current) {
      prevSocialJson.current = socialJson;
      setSocialData(social);
    }
    const footerJson = JSON.stringify(footer);
    if (footerJson !== prevFooterJson.current) {
      prevFooterJson.current = footerJson;
      setFooterData(footer);
    }
  }, [logo, contact, social, footer]);

  return (
    <Tabs defaultValue="logo" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="logo" className="flex items-center gap-2">
          <Image className="h-4 w-4" />
          Logo
        </TabsTrigger>
        <TabsTrigger value="contact" className="flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Contact
        </TabsTrigger>
        <TabsTrigger value="social" className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Social
        </TabsTrigger>
        <TabsTrigger value="footer" className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Footer
        </TabsTrigger>
      </TabsList>

      {/* Logo Tab */}
      <TabsContent value="logo">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="h-5 w-5 text-accent" />
              Logo & Branding
            </CardTitle>
            <CardDescription>
              Upload your logo for the header and footer. You can resize before uploading.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <LogoUploadWithResize
              currentLogoUrl={logoData.logo_url}
              logoAlt={logoData.logo_alt}
              onLogoChange={(url) => setLogoData({ ...logoData, logo_url: url })}
              onAltChange={(alt) => setLogoData({ ...logoData, logo_alt: alt })}
              label="Site Logo"
              description="Upload your logo (recommended: PNG with transparent background)"
            />

            <div className="border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="favicon-url">Favicon URL (Optional)</Label>
                <Input
                  id="favicon-url"
                  value={logoData.favicon_url || ""}
                  onChange={(e) => setLogoData({ ...logoData, favicon_url: e.target.value })}
                  placeholder="https://example.com/favicon.ico"
                />
                <p className="text-xs text-muted-foreground">
                  The small icon shown in browser tabs (ICO or PNG, 32x32 recommended)
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => onSaveLogo(logoData)} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Logo
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Contact Tab */}
      <TabsContent value="contact">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-accent" />
              Contact Information
            </CardTitle>
            <CardDescription>
              Phone, email, and address shown in footer and contact pages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number (for links)</Label>
                <Input
                  id="phone"
                  value={contactData.phone}
                  onChange={(e) => setContactData({ ...contactData, phone: e.target.value })}
                  placeholder="+19725156635"
                />
                <p className="text-xs text-muted-foreground">Format: +1XXXXXXXXXX</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone-display">Phone Display Text</Label>
                <Input
                  id="phone-display"
                  value={contactData.phone_display}
                  onChange={(e) => setContactData({ ...contactData, phone_display: e.target.value })}
                  placeholder="(972) 515-6635"
                />
                <p className="text-xs text-muted-foreground">How the number appears to users</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={contactData.email}
                onChange={(e) => setContactData({ ...contactData, email: e.target.value })}
                placeholder="info@drive247.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address1">Address Line 1</Label>
              <Input
                id="address1"
                value={contactData.address_line1}
                onChange={(e) => setContactData({ ...contactData, address_line1: e.target.value })}
                placeholder="123 Main Street"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address2">Address Line 2 (Optional)</Label>
              <Input
                id="address2"
                value={contactData.address_line2 || ""}
                onChange={(e) => setContactData({ ...contactData, address_line2: e.target.value })}
                placeholder="Suite 100"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={contactData.city}
                  onChange={(e) => setContactData({ ...contactData, city: e.target.value })}
                  placeholder="Dallas"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={contactData.state}
                  onChange={(e) => setContactData({ ...contactData, state: e.target.value })}
                  placeholder="TX"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip">ZIP Code</Label>
                <Input
                  id="zip"
                  value={contactData.zip}
                  onChange={(e) => setContactData({ ...contactData, zip: e.target.value })}
                  placeholder="75201"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={contactData.country}
                  onChange={(e) => setContactData({ ...contactData, country: e.target.value })}
                  placeholder="USA"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maps-url">Google Maps URL (Optional)</Label>
              <Input
                id="maps-url"
                value={contactData.google_maps_url || ""}
                onChange={(e) => setContactData({ ...contactData, google_maps_url: e.target.value })}
                placeholder="https://maps.google.com/..."
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => onSaveContact(contactData)} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Contact Info
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Social Tab */}
      <TabsContent value="social">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-accent" />
              Social Media Links
            </CardTitle>
            <CardDescription>
              Links to your social media profiles (leave blank to hide)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="facebook">Facebook</Label>
                <Input
                  id="facebook"
                  value={socialData.facebook || ""}
                  onChange={(e) => setSocialData({ ...socialData, facebook: e.target.value })}
                  placeholder="https://facebook.com/drive247"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instagram">Instagram</Label>
                <Input
                  id="instagram"
                  value={socialData.instagram || ""}
                  onChange={(e) => setSocialData({ ...socialData, instagram: e.target.value })}
                  placeholder="https://instagram.com/drive247"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="twitter">Twitter / X</Label>
                <Input
                  id="twitter"
                  value={socialData.twitter || ""}
                  onChange={(e) => setSocialData({ ...socialData, twitter: e.target.value })}
                  placeholder="https://twitter.com/drive247"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="linkedin">LinkedIn</Label>
                <Input
                  id="linkedin"
                  value={socialData.linkedin || ""}
                  onChange={(e) => setSocialData({ ...socialData, linkedin: e.target.value })}
                  placeholder="https://linkedin.com/company/drive247"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="youtube">YouTube</Label>
                <Input
                  id="youtube"
                  value={socialData.youtube || ""}
                  onChange={(e) => setSocialData({ ...socialData, youtube: e.target.value })}
                  placeholder="https://youtube.com/@drive247"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tiktok">TikTok</Label>
                <Input
                  id="tiktok"
                  value={socialData.tiktok || ""}
                  onChange={(e) => setSocialData({ ...socialData, tiktok: e.target.value })}
                  placeholder="https://tiktok.com/@drive247"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => onSaveSocial(socialData)} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Social Links
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Footer Tab */}
      <TabsContent value="footer">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-accent" />
              Footer Settings
            </CardTitle>
            <CardDescription>
              Copyright text and tagline for the footer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="copyright">Copyright Text</Label>
              <Input
                id="copyright"
                value={footerData.copyright_text}
                onChange={(e) => setFooterData({ ...footerData, copyright_text: e.target.value })}
                placeholder="© 2024 Drive 917. All rights reserved."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tagline">Tagline (Optional)</Label>
              <Input
                id="tagline"
                value={footerData.tagline || ""}
                onChange={(e) => setFooterData({ ...footerData, tagline: e.target.value })}
                placeholder="Premium Car Rentals in Dallas"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => onSaveFooter(footerData)} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Footer
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
