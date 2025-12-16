import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageContent, defaultTermsContent, mergeWithDefaults } from "@/hooks/usePageContent";

const Terms = () => {
  const { data: rawContent, isLoading } = usePageContent("terms");
  const content = mergeWithDefaults(rawContent, defaultTermsContent);
  const termsContent = content.terms_content!;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <section className="pt-32 pb-20">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <Skeleton className="h-16 w-96 mb-6" />
              <Skeleton className="h-[600px] w-full" />
            </div>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <section className="pt-32 pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-6xl font-display font-bold mb-6 text-gradient-metal">
              {termsContent.title}
            </h1>

            <Card className="p-8 md:p-12 shadow-metal bg-card/50 backdrop-blur">
              <style>{`
                .legal-content h2 {
                  font-size: 1.5rem;
                  font-weight: 700;
                  margin-top: 1.5rem;
                  margin-bottom: 0.75rem;
                  color: hsl(var(--primary));
                  font-family: var(--font-display);
                }
                .legal-content h2:first-child {
                  margin-top: 0;
                }
                .legal-content p {
                  color: hsl(var(--muted-foreground));
                  margin-bottom: 1rem;
                  line-height: 1.75;
                }
                .legal-content ul {
                  list-style-type: disc;
                  margin-left: 1.5rem;
                  margin-bottom: 1rem;
                  color: hsl(var(--muted-foreground));
                }
                .legal-content li {
                  margin-bottom: 0.5rem;
                  line-height: 1.6;
                }
                .legal-content a {
                  color: hsl(var(--accent));
                  text-decoration: none;
                }
                .legal-content a:hover {
                  text-decoration: underline;
                }
              `}</style>
              <div
                className="legal-content"
                dangerouslySetInnerHTML={{ __html: termsContent.content }}
              />

              {termsContent.last_updated && (
                <p className="text-sm text-muted-foreground pt-6 mt-6 border-t border-border">
                  Last updated: {new Date(termsContent.last_updated).toLocaleDateString()}
                </p>
              )}
            </Card>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Terms;
