import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SiteSettings from "./admin/SiteSettings";
import FAQManagement from "./admin/FAQManagement";
import AuditLogs from "./admin/AuditLogs";

export default function AdminSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
          Settings
        </h1>
        <p className="text-muted-foreground">
          Manage site configuration, FAQs, and view audit logs
        </p>
      </div>

      <Tabs defaultValue="site" className="space-y-6">
        <TabsList>
          <TabsTrigger value="site">Site Settings</TabsTrigger>
          <TabsTrigger value="faq">FAQ Management</TabsTrigger>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="site">
          <SiteSettings />
        </TabsContent>

        <TabsContent value="faq">
          <FAQManagement />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogs />
        </TabsContent>
      </Tabs>
    </div>
  );
}
