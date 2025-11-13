import { Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ContactCard = () => {
  return (
    <section className="py-16 bg-background">
      <div className="container mx-auto px-4">
        <Card className="max-w-4xl mx-auto shadow-lg border-border/50 bg-card">
          <CardContent className="p-8 md:p-12">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
                  Have Questions About Your Rental?
                </h2>
                <p className="text-lg text-muted-foreground">
                  We're here to help 7 days a week. Reach out to our Dallas team for quick answers and booking support.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 shrink-0">
                <a href="tel:+19725156635">
                  <Button 
                    size="lg" 
                    className="bg-[#F5B942] hover:bg-[#E9B63E] text-[#0C1A17] font-semibold px-8 py-6 shadow-md hover:shadow-lg transition-all"
                  >
                    <Phone className="w-5 h-5 mr-2" />
                    Call Now
                  </Button>
                </a>
                <a href="mailto:info@drive917.com">
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-2 border-foreground text-foreground hover:bg-foreground hover:text-background font-semibold px-8 py-6 transition-all"
                  >
                    <Mail className="w-5 h-5 mr-2" />
                    Email Us
                  </Button>
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default ContactCard;
