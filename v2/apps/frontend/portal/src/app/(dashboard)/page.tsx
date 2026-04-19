'use client';

import { useEffect, useState } from 'react';
import { usePortalAuthStore } from '@/stores/portal-auth-store';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Separator,
} from '@drive247/ui';
import { bonzahApi } from '@/lib/api';
import { DashboardBalanceWidget } from '@/components/bonzah/dashboard-balance-widget';

export default function DashboardPage() {
  const { user } = usePortalAuthStore();
  const [bonzahConnected, setBonzahConnected] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: res } = await bonzahApi.getConnection();
        if (res.success) setBonzahConnected(res.data.connected);
      } catch {
        // widget stays hidden on error
      }
    })();
  }, []);

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-[30px] font-medium text-[#080812]">Dashboard</h2>

      <DashboardBalanceWidget connected={bonzahConnected} />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Name</p>
              <p className="font-medium">{user?.name || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{user?.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Role</p>
              <Badge variant="secondary">{user?.role}</Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Super Admin</p>
              <Badge variant={user?.isSuperAdmin ? 'default' : 'outline'}>
                {user?.isSuperAdmin ? 'Yes' : 'No'}
              </Badge>
            </div>
          </div>
          {user?.mustChangePassword && (
            <>
              <Separator />
              <p className="text-sm text-destructive font-medium">
                You must change your password before continuing.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auth Test Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>Access token stored in memory (Zustand).</p>
            <p>Refresh token stored in httpOnly cookie (not visible to JS).</p>
            <p>
              Try refreshing the page — the app will auto-recover your session
              via the refresh endpoint.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
