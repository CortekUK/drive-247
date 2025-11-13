import { Car, Shield, Clock, Award } from "lucide-react";
import { Card } from "@/components/ui/card";

const ServiceHighlights = () => {
  const services = [
    {
      icon: Car,
      title: "Elite Fleet",
      description: "Mercedes S-Class, Rolls-Royce Phantom, Range Rover and more premium vehicles",
    },
    {
      icon: Shield,
      title: "Close Protection",
      description: "Highly trained security professionals with military and law enforcement backgrounds",
    },
    {
      icon: Clock,
      title: "24/7 Availability",
      description: "Round-the-clock service with immediate response for urgent bookings",
    },
    {
      icon: Award,
      title: "Discreet Excellence",
      description: "Impeccable service standards with absolute confidentiality guaranteed",
    },
  ];

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <h2 className="text-4xl md:text-5xl font-display font-bold text-center mb-12 text-gradient-metal pb-2">
          Why Choose Supreme Drive
        </h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {services.map((service, index) => (
            <Card
              key={index}
              className="p-6 shadow-metal hover:shadow-glow transition-all duration-300 bg-card/50 backdrop-blur group"
            >
              <div className="w-14 h-14 rounded-full gradient-metal flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <service.icon className="w-7 h-7 text-background" />
              </div>
              <h3 className="text-xl font-display font-semibold mb-2">{service.title}</h3>
              <p className="text-muted-foreground">{service.description}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServiceHighlights;
