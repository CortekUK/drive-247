import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CTAButton {
  text: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

interface UniversalHeroProps {
  headline: string | React.ReactNode;
  subheading: string;
  backgroundImage: string;
  backgroundAlt: string;
  overlayStrength?: 'light' | 'medium' | 'strong';
  primaryCTA: CTAButton;
  secondaryCTA?: CTAButton;
  trustLine?: string[];
  showScrollIndicator?: boolean;
  minHeight?: string;
}

const overlayClasses = {
  light: 'bg-gradient-to-t from-black/40 via-black/30 to-black/20',
  medium: 'bg-gradient-to-t from-black/70 via-black/50 to-black/30',
  strong: 'bg-gradient-to-t from-black/90 via-black/70 to-black/50'
};

const UniversalHero: React.FC<UniversalHeroProps> = ({
  headline,
  subheading,
  backgroundImage,
  backgroundAlt,
  overlayStrength = 'medium',
  primaryCTA,
  secondaryCTA,
  trustLine,
  showScrollIndicator = false,
  minHeight = 'min-h-screen'
}) => {
  const renderCTA = (cta: CTAButton, isPrimary: boolean) => {
    const buttonContent = (
      <Button
        size="lg"
        variant={isPrimary ? "default" : "outline"}
        className={cn(
          "text-base md:text-lg  px-6 md:px-8 py-3 md:py-4 font-semibold w-full sm:w-auto transition-all",
          isPrimary
            ? "gradient-accent  shadow-glow hover:shadow-glow hover:scale-105"
            : "border-2 border-white bg-white/10 text-white backdrop-blur-sm hover:bg-white hover:text-black"
        )}
        onClick={cta.onClick}
      >
        {cta.icon && <span className="mr-2">{cta.icon}</span>}
        {cta.text}
      </Button>
    );

    if (cta.href && !cta.onClick) {
      return (
        <a href={cta.href} className="block  sm:inline-block">
          {buttonContent}
        </a>
      );
    }

    return buttonContent;
  };

  return (
    <section 
      className={cn(
        "relative flex items-center justify-center overflow-hidden pt-20",
        minHeight
      )}
      role="banner"
    >
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${backgroundImage})` }}
        role="img"
        aria-label={backgroundAlt}
      >
        <div className={cn("absolute inset-0", overlayClasses[overlayStrength])} />
      </div>
      
      {/* Content */}
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-5xl mx-auto text-center space-y-6 md:space-y-8">
          
          {/* Headline */}
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-display font-extrabold text-white leading-tight">
              {headline}
            </h1>
            
            {/* Subheading */}
            <p className="text-base md:text-lg lg:text-xl text-white/85 max-w-3xl mx-auto font-sans font-light leading-relaxed">
              {subheading}
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-200">
            {renderCTA(primaryCTA, true)}
            {secondaryCTA && renderCTA(secondaryCTA, false)}
          </div>

          {/* Trust Line */}
          {trustLine && trustLine.length > 0 && (
            <p className="text-xs md:text-sm text-white/60 font-medium font-sans animate-in fade-in duration-1000 delay-300">
              {trustLine.join(' • ')}
            </p>
          )}
        </div>
      </div>

      {/* Scroll Indicator */}
      {showScrollIndicator && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce" aria-hidden="true">
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center">
            <div className="w-1 h-3 bg-white rounded-full mt-2" />
          </div>
        </div>
      )}
    </section>
  );
};

export default UniversalHero;