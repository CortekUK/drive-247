import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Card } from "@/components/ui/card";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <section className="pt-32 pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-6xl font-display font-bold mb-6 text-gradient-metal">
              Privacy Policy
            </h1>
            
            <Card className="p-8 md:p-12 shadow-metal bg-card/50 backdrop-blur space-y-6">
              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Introduction
                </h2>
                <p className="text-muted-foreground">
                  Supreme Drive Suite is committed to protecting your privacy and ensuring the security of your personal information. 
                  This policy outlines how we collect, use, and safeguard your data.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Information We Collect
                </h2>
                <p className="text-muted-foreground mb-2">
                  We collect information necessary to provide our services, including:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                  <li>Contact details (name, email, phone number)</li>
                  <li>Booking information (pickup/drop-off locations, dates, times)</li>
                  <li>Payment information (processed securely through third-party providers)</li>
                  <li>Service preferences and special requirements</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  How We Use Your Information
                </h2>
                <p className="text-muted-foreground mb-2">
                  Your information is used exclusively for:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                  <li>Providing and managing our chauffeur and security services</li>
                  <li>Processing bookings and payments</li>
                  <li>Communicating with you about your bookings</li>
                  <li>Improving our services based on your feedback</li>
                  <li>Complying with legal obligations</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Data Security
                </h2>
                <p className="text-muted-foreground">
                  We implement industry-standard security measures to protect your personal information from unauthorized access, 
                  disclosure, or misuse. All data is encrypted both in transit and at rest. Our staff are bound by strict 
                  confidentiality agreements.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Your Rights
                </h2>
                <p className="text-muted-foreground mb-2">
                  Under GDPR, you have the right to:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                  <li>Access your personal data</li>
                  <li>Correct inaccurate data</li>
                  <li>Request deletion of your data</li>
                  <li>Object to processing of your data</li>
                  <li>Data portability</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold mb-3 text-primary">
                  Contact Us
                </h2>
                <p className="text-muted-foreground">
                  For any privacy-related questions or requests, please contact us at{" "}
                  <a href="mailto:privacy@supremedrive.co.uk" className="text-accent hover:underline">
                    privacy@supremedrive.co.uk
                  </a>
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

export default Privacy;
