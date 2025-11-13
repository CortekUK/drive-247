import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar, MapPin, Star, Shield } from "lucide-react";
import { format } from "date-fns";

interface PortfolioCardProps {
  item: {
    slug: string;
    title: string;
    summary: string;
    cover_image_url: string;
    service_type: string;
    location: string;
    event_date: string;
    is_featured: boolean;
    is_confidential?: boolean;
  };
}

export const PortfolioCard = ({ item }: PortfolioCardProps) => {
  return (
    <Link to={`/portfolio/${item.slug}`} className="w-full md:min-w-[400px]">
      <Card className="group w-full md:min-w-[400px] overflow-hidden transition-all duration-500 hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)] hover:shadow-glow hover:-translate-y-2 hover:border-accent/50 bg-card border-border/50 min-h-[480px] flex flex-col">
        <div className="relative aspect-video overflow-hidden">
          <img
            src={item.cover_image_url}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            loading="lazy"
            onError={(e) => {
              console.error("Failed to load portfolio image:", item.cover_image_url, "for item:", item.slug);
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/40 to-transparent opacity-90 group-hover:opacity-80 transition-opacity duration-500" />
          
          {/* Badges Container - Prevents Overlap */}
          <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 z-10">
            {/* Service Type Badge - Left */}
            <Badge 
              variant={
                item.service_type === "both" 
                  ? "default" 
                  : item.service_type === "chauffeur" 
                  ? "default" 
                  : "secondary"
              }
              className="backdrop-blur-md shadow-lg border-background/20 flex-shrink-0"
            >
              {item.service_type === "chauffeur" 
                ? "Chauffeur" 
                : item.service_type === "close_protection"
                ? "Close Protection"
                : "Both Services"}
            </Badge>

            {/* Status Badge - Right */}
            {item.is_confidential ? (
              <Badge className="bg-secondary/95 backdrop-blur-md text-secondary-foreground border-background/20 gap-1.5 shadow-lg flex-shrink-0">
                <Shield className="w-3 h-3" />
                Confidential
              </Badge>
            ) : item.is_featured ? (
              <Badge className="bg-accent/95 backdrop-blur-md text-accent-foreground border-accent-foreground/20 gap-1.5 shadow-[0_0_20px_rgba(255,215,0,0.3)] flex-shrink-0">
                <Star className="w-3 h-3 fill-current" />
                Featured
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="p-8 space-y-4 flex-1 flex flex-col">
          <h3 className="text-2xl font-display font-semibold group-hover:text-accent transition-colors duration-300 line-clamp-3">
            {item.title}
          </h3>
          
          <p className="text-sm  text-muted-foreground leading-relaxed line-clamp-3 flex-1">
            {item.is_confidential ? "Details available upon request" : item.summary}
          </p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t border-border/50 mt-auto">
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span>{item.is_confidential ? "Private Location" : item.location}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{format(new Date(item.event_date), "MMM yyyy")}</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
};
