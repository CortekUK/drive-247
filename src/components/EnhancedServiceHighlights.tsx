import { ThumbsUp, Users, MapPin, Baby, Settings, Headphones, Shield, Car, Clock, Phone, Star, Award, CheckCircle, Fuel, Wifi, Crown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { usePageContent, defaultHomeContent, mergeWithDefaults } from "@/hooks/usePageContent";

// Map icon names to actual icon components
const getIconComponent = (iconName: string) => {
  const icons: Record<string, any> = {
    ThumbsUp,
    Users,
    MapPin,
    Baby,
    Settings,
    Headphones,
    Shield,
    Car,
    Clock,
    Phone,
    Star,
    Award,
    CheckCircle,
    Fuel,
    Wifi,
    Crown,
  };
  return icons[iconName] || ThumbsUp;
};

const EnhancedServiceHighlights = () => {
  // CMS Content
  const { data: rawContent } = usePageContent("home");
  const content = mergeWithDefaults(rawContent, defaultHomeContent);

  const services = content.service_highlights?.services || [];

  return (
    <section className="py-24 md:py-28 lg:py-32 bg-muted/30 relative">
      <div className="container mx-auto px-4 relative">
        <div className="text-center mb-16 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-display font-bold mb-4 text-foreground">
            {content.service_highlights?.title || "Why Choose Drive917"}
          </h2>
          <div className="flex items-center justify-center mt-6">
            <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-[#F5B942] to-transparent" />
          </div>
          <p className="text-base md:text-lg text-foreground/70 max-w-3xl mx-auto font-light mt-6">
            {content.service_highlights?.subtitle || "Delivering excellence through premium vehicle rentals and exceptional service."}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 max-w-7xl mx-auto">
          {services.map((service, index) => {
            const Icon = getIconComponent(service.icon);
            return (
              <Card
                key={index}
                className="relative overflow-hidden p-8 lg:p-10 bg-card border border-border hover:border-[#F5B942]/30 transition-all duration-500 hover:-translate-y-2 shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_12px_40px_rgba(245,185,66,0.2)] animate-fade-in-up group rounded-2xl"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="relative space-y-5 flex flex-col">
                  {/* Gold circular icon with glow */}
                  <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#F5B942] to-[#E9B63E] flex items-center justify-center shadow-[0_0_24px_rgba(245,185,66,0.35)] group-hover:shadow-[0_0_32px_rgba(245,185,66,0.5)] transition-all duration-500">
                    <Icon className="w-8 h-8 text-white" strokeWidth={2} aria-hidden="true" />
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-2xl font-display font-bold text-foreground leading-tight">
                      {service.title}
                    </h3>
                    <p className="text-foreground/70 leading-relaxed text-[15px]">
                      {service.description}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default EnhancedServiceHighlights;
