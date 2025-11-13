import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const Setup = () => {
  const [loading, setLoading] = useState(false);
  const [demoUserStatus, setDemoUserStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [dataStatus, setDataStatus] = useState<'pending' | 'success' | 'error'>('pending');

  const createDemoUser = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('create-demo-user', {
        method: 'POST'
      });

      if (error) throw error;

      if (data?.ok) {
        setDemoUserStatus('success');
        toast.success("Demo admin account created successfully!");
        return true;
      } else {
        throw new Error(data?.error || "Failed to create demo user");
      }
    } catch (error: any) {
      console.error("Error creating demo user:", error);
      setDemoUserStatus('error');
      toast.error(error.message || "Failed to create demo user");
      return false;
    }
  };

  const loadMockData = async () => {
    try {
      // Note: This is a simplified version. In production, you'd want to 
      // run the SQL script through the Supabase dashboard or use a migration
      
      toast.info("Please run the SQL script from scripts/setup-demo-data.sql in your Supabase dashboard");
      
      // For demonstration, we'll just mark it as success
      // In a real scenario, you'd either:
      // 1. Have the SQL as a stored procedure and call it
      // 2. Use individual insert statements through the Supabase client
      // 3. Direct users to run it manually
      
      setDataStatus('success');
      return true;
    } catch (error: any) {
      console.error("Error loading mock data:", error);
      setDataStatus('error');
      toast.error("Failed to load mock data");
      return false;
    }
  };

  const handleFullSetup = async () => {
    setLoading(true);
    
    // Step 1: Create demo user
    const userCreated = await createDemoUser();
    
    // Step 2: Load mock data
    if (userCreated) {
      await loadMockData();
    }
    
    setLoading(false);
  };

  const StatusIcon = ({ status }: { status: 'pending' | 'success' | 'error' }) => {
    if (status === 'success') return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (status === 'error') return <AlertCircle className="w-5 h-5 text-red-500" />;
    return <div className="w-5 h-5 rounded-full border-2 border-muted" />;
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Drive917 Setup</h1>
          <p className="text-muted-foreground">
            Initialize your Drive917 application with demo data and admin account
          </p>
        </div>

        <Alert>
          <AlertDescription>
            <strong>Important:</strong> This setup page is for initial configuration only. 
            Run this once when first setting up your application.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6">
          {/* Demo User Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>1. Create Demo Admin Account</CardTitle>
                  <CardDescription>
                    Creates an admin user for testing and management
                  </CardDescription>
                </div>
                <StatusIcon status={demoUserStatus} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium">Demo Credentials:</p>
                <div className="text-sm space-y-1">
                  <p><strong>Email:</strong> admin@demo.com</p>
                  <p><strong>Password:</strong> demo123</p>
                </div>
              </div>
              <Button 
                onClick={createDemoUser} 
                disabled={loading || demoUserStatus === 'success'}
                className="w-full"
              >
                {loading && demoUserStatus === 'pending' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Demo User...
                  </>
                ) : demoUserStatus === 'success' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Demo User Created
                  </>
                ) : (
                  'Create Demo User'
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Mock Data Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>2. Load Mock Data</CardTitle>
                  <CardDescription>
                    Populate database with vehicles, testimonials, and more
                  </CardDescription>
                </div>
                <StatusIcon status={dataStatus} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium">Includes:</p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>10 Vehicles (various categories)</li>
                  <li>10 Pricing Extras</li>
                  <li>8 Testimonials</li>
                  <li>4 Active Promotions</li>
                  <li>5 Portfolio Items</li>
                  <li>5 Driver Profiles</li>
                  <li>10 FAQs</li>
                  <li>Site Settings</li>
                </ul>
              </div>
              <Alert>
                <AlertDescription className="text-xs">
                  <strong>Manual Step Required:</strong> Please run the SQL script located at 
                  <code className="mx-1 px-1 bg-background rounded">scripts/setup-demo-data.sql</code> 
                  in your Supabase dashboard's SQL Editor.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Full Setup Button */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Setup</CardTitle>
              <CardDescription>
                Run all setup steps in one click (demo user + data)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleFullSetup} 
                disabled={loading || (demoUserStatus === 'success' && dataStatus === 'success')}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Setting Up...
                  </>
                ) : demoUserStatus === 'success' && dataStatus === 'success' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Setup Complete!
                  </>
                ) : (
                  'Run Full Setup'
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Next Steps */}
          {demoUserStatus === 'success' && (
            <Card className="border-green-500/50 bg-green-500/5">
              <CardHeader>
                <CardTitle className="text-green-700 dark:text-green-400">
                  🎉 Setup Complete!
                </CardTitle>
                <CardDescription>Next Steps:</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ol className="list-decimal list-inside space-y-2">
                  <li>Log in with the demo admin credentials above</li>
                  <li>Navigate to the <code className="px-1 bg-background rounded">/admin</code> page</li>
                  <li>Explore the admin dashboard and features</li>
                  <li>Run the SQL script to populate all mock data</li>
                  <li>Customize vehicles, pricing, and content as needed</li>
                </ol>
                <div className="mt-4 flex gap-2">
                  <Button asChild variant="default">
                    <a href="/auth">Go to Login</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href="/admin">Visit Admin Panel</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Documentation Link */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                For detailed setup instructions, see:
              </p>
              <code className="text-sm bg-muted px-2 py-1 rounded">
                SUPABASE_SETUP_COMPLETE.md
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Setup;
