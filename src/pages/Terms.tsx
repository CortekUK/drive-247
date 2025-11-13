import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Card } from "@/components/ui/card";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <section className="pt-32 pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-6xl font-display font-bold mb-6 text-gradient-metal">
              Terms of Service
            </h1>
            
            <Card className="p-8 md:p-12 shadow-metal bg-card/50 backdrop-blur space-y-6">
              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Service Agreement
                </h2>
                <p className="text-muted-foreground">
                  By booking our services, you agree to these terms and conditions. Supreme Drive Suite reserves the right 
                  to modify these terms at any time, with changes effective immediately upon posting.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Booking and Payment
                </h2>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>All bookings are subject to availability</li>
                  <li>Payment is required at the time of booking unless credit terms have been agreed</li>
                  <li>Cancellations made less than 24 hours before pickup may incur a 50% cancellation fee</li>
                  <li>No-shows will be charged the full booking amount</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Service Standards
                </h2>
                <p className="text-muted-foreground mb-2">
                  We are committed to providing the highest standards of service:
                </p>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>All chauffeurs are professionally trained and fully licensed</li>
                  <li>Vehicles are maintained to the highest standards</li>
                  <li>Close protection officers hold appropriate SIA licenses</li>
                  <li>Comprehensive insurance coverage is maintained on all vehicles and operations</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Client Responsibilities
                </h2>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                  <li>Provide accurate pickup and destination information</li>
                  <li>Be ready at the agreed pickup time</li>
                  <li>Treat our chauffeurs and vehicles with respect</li>
                  <li>Report any issues immediately</li>
                  <li>Comply with all reasonable requests from our security personnel</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Liability
                </h2>
                <p className="text-muted-foreground">
                  While we take every precaution to ensure your safety and comfort, Supreme Drive Suite's liability 
                  is limited to the value of the service provided. We are not liable for delays caused by circumstances 
                  beyond our control, including traffic, weather, or road conditions.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Confidentiality
                </h2>
                <p className="text-muted-foreground">
                  All our staff are bound by strict confidentiality agreements. Any information shared during the course 
                  of our service will be kept strictly confidential unless disclosure is required by law.
                </p>
              </div>

              <p className="text-sm text-muted-foreground pt-6 border-t border-border">
                Last updated: {new Date().toLocaleDateString()}
              </p>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Terms;
