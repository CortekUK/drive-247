import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";

const GDPRConsent = () => {
  const [showBanner, setShowBanner] = useState(false);
  const [consent, setConsent] = useState({
    necessary: true, // Always required
    analytics: false,
    marketing: false,
  });

  useEffect(() => {
    const hasConsent = localStorage.getItem("gdpr-consent");
    if (!hasConsent) {
      setShowBanner(true);
    }
  }, []);

  const handleAcceptAll = () => {
    const fullConsent = {
      necessary: true,
      analytics: true,
      marketing: true,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem("gdpr-consent", JSON.stringify(fullConsent));
    setShowBanner(false);
  };

  const handleSavePreferences = () => {
    const preferences = {
      ...consent,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem("gdpr-consent", JSON.stringify(preferences));
    setShowBanner(false);
  };

  const handleRejectAll = () => {
    const minimalConsent = {
      necessary: true,
      analytics: false,
      marketing: false,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem("gdpr-consent", JSON.stringify(minimalConsent));
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-background/95 backdrop-blur-sm border-t border-border">
      <Card className="max-w-4xl mx-auto p-6 shadow-metal">
        <h3 className="text-xl font-display font-bold mb-3">Cookie Consent</h3>
        <p className="text-sm text-muted-foreground mb-4">
          We use cookies to enhance your browsing experience, serve personalized content, and analyze our traffic. 
          By clicking "Accept All", you consent to our use of cookies. Read our{" "}
          <Link to="/privacy" className="text-primary underline">Privacy Policy</Link> for more information.
        </p>

        <div className="space-y-3 mb-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="necessary" checked={consent.necessary} disabled />
            <Label htmlFor="necessary" className="text-sm cursor-not-allowed opacity-70">
              Necessary cookies (always required)
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox 
              id="analytics" 
              checked={consent.analytics}
              onCheckedChange={(checked) => setConsent({ ...consent, analytics: checked as boolean })}
            />
            <Label htmlFor="analytics" className="text-sm cursor-pointer">
              Analytics cookies (help us improve our service)
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox 
              id="marketing" 
              checked={consent.marketing}
              onCheckedChange={(checked) => setConsent({ ...consent, marketing: checked as boolean })}
            />
            <Label htmlFor="marketing" className="text-sm cursor-pointer">
              Marketing cookies (personalized content)
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleAcceptAll} className="gradient-accent shadow-glow">
            Accept All
          </Button>
          <Button onClick={handleSavePreferences} variant="outline">
            Save Preferences
          </Button>
          <Button onClick={handleRejectAll} variant="ghost">
            Reject All
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default GDPRConsent;
