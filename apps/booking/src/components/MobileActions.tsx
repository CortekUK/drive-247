import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings";

const MobileActions = () => {
  const { settings } = useSiteSettings();
  
  // Format phone number for tel: link (remove spaces and special chars except +)
  const phoneLink = settings.phone.replace(/[^\d+]/g, '');
  
  return (
    <div className="lg:hidden fixed bottom-4 right-4 z-40">
      <a
        href={`tel:${phoneLink}`}
        aria-label="Call us"
      >
        <Button size="lg" className="gradient-accent shadow-glow rounded-full w-14 h-14 p-0">
          <Phone className="w-6 h-6" />
        </Button>
      </a>
    </div>
  );
};

export default MobileActions;
