import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Smartphone, Monitor, CheckCircle2, Download } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PWAInstallProps {
  title?: string;
  description?: string;
}

const PWAInstall = ({ title, description }: PWAInstallProps) => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const isMobile = useIsMobile();
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isSafari, setIsSafari] = useState(false);


  useEffect(() => {
    // Detect platform on client side only
    if (typeof navigator !== "undefined") {
      setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
      setIsAndroid(/Android/.test(navigator.userAgent));
      setIsSafari(/^((?!chrome|android).)*safari/i.test(navigator.userAgent));
    }

    const checkInstalled = () => {
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
      setIsInstalled(isStandalone);
    };
    checkInstalled();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      setShowInstructions(true);
    }
  };

  useEffect(() => {
    // Detect platform on client side only
    if (typeof navigator !== "undefined") {
      setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
      setIsAndroid(/Android/.test(navigator.userAgent));
      setIsSafari(/^((?!chrome|android).)*safari/i.test(navigator.userAgent));
    }

    if (isIOS && !isInstalled) {
      setShowInstructions(true);
    }
  }, [isIOS, isInstalled]);

  if (isInstalled) {
    return (
      <section className="py-10 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="pwa-card">
            <div className="flex-1 text-center">
              <h3 className="text-2xl md:text-3xl font-display font-bold mb-2 text-foreground flex items-center justify-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-accent" /> App Installed
              </h3>
              <p className="text-base text-muted-foreground">
                Drive247 is installed on your device. Find it on your home screen for quick access.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="pwa-card">
          <div className="flex-1">
            <h3 className="text-2xl md:text-3xl font-display font-bold mb-2 text-foreground">
              {title || "Install Drive247"}
            </h3>
            <p className="text-base text-muted-foreground mb-6">
              {description || "Add Drive247 to your home screen for fast, seamless bookings in Los Angeles and beyond."}
            </p>

            <div className="flex flex-wrap gap-3 mb-4">
              {(deferredPrompt || isAndroid || isIOS) && (
                <Button
                  onClick={handleInstallClick}
                  className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
                  size="lg"
                >
                  Install App
                </Button>
              )}

              <Button
                onClick={() => setShowInstructions(!showInstructions)}
                variant="outline"
                className="border-accent/30 hover:border-accent/50 hover:bg-accent/10"
                size="lg"
              >
                How it works
              </Button>
            </div>

            {showInstructions && (
              <div className="mt-6 p-5 rounded-lg bg-muted/30 border border-accent/20 animate-fade-in">
                <Tabs
                  defaultValue={isIOS ? "ios" : isAndroid ? "android" : "desktop"}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="ios" className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      iPhone
                    </TabsTrigger>
                    <TabsTrigger value="android" className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      Android
                    </TabsTrigger>
                    <TabsTrigger value="desktop" className="flex items-center gap-2">
                      <Monitor className="h-4 w-4" />
                      Desktop
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="ios" className="mt-4">
                    <div>
                      <h4 className="font-semibold text-foreground mb-3">Install on iPhone</h4>
                      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                        <li>Tap the <strong className="text-foreground">Share</strong> button at the bottom of Safari</li>
                        <li>Scroll down and choose <strong className="text-foreground">Add to Home Screen</strong></li>
                        <li>Tap <strong className="text-foreground">Add</strong> in the top right</li>
                        <li>Find the Drive247 icon on your home screen</li>
                      </ol>
                    </div>
                  </TabsContent>

                  <TabsContent value="android" className="mt-4">
                    <div>
                      <h4 className="font-semibold text-foreground mb-3">Install on Android</h4>
                      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                        <li>Tap <strong className="text-foreground">Install App</strong> button above or the menu</li>
                        <li>Select <strong className="text-foreground">Add to Home screen</strong> or <strong className="text-foreground">Install</strong></li>
                        <li>Confirm the installation</li>
                      </ol>
                    </div>
                  </TabsContent>

                  <TabsContent value="desktop" className="mt-4">
                    <div>
                      <h4 className="font-semibold text-foreground mb-3">Install on Desktop</h4>
                      {isSafari ? (
                        <p className="text-sm text-muted-foreground">
                          Safari on Mac doesn't support PWA installation. Please use <strong className="text-foreground">Chrome</strong> or <strong className="text-foreground">Edge</strong>.
                        </p>
                      ) : (
                        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                          <li>Click <strong className="text-foreground">Install</strong> icon in the address bar</li>
                          <li>Click <strong className="text-foreground">Install</strong> from the dialogue box</li>
                        </ol>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>

          {/* PWA Install Button - replaces QR code */}
          <div className="flex flex-col items-center gap-3 mt-6 sm:mt-0">
            <button
              onClick={handleInstallClick}
              className="w-36 h-36 rounded-2xl border border-accent/20 bg-accent/5 hover:bg-accent/10 transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-12 h-12 text-accent" />
              <span className="text-sm font-medium text-accent">Install</span>
            </button>
            <p className="text-xs text-muted-foreground text-center">
              Tap to install app
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PWAInstall;
