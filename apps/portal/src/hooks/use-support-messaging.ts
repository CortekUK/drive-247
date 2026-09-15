'use client';
import { useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { supabase } from '@/integrations/supabase/client';
import { useMessagingClient, useSupportUnread } from '../../../../shared/trax-support/client';
const token=async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token??null;};
export function useSupportMessaging(){
  const {tenant}=useTenant();const {appUser,user}=useAuthStore();const {permissions}=useManagerPermissions();
  const scope=JSON.stringify([tenant?.id,user?.id,appUser?.id,appUser?.role,appUser?.is_active,permissions]);
  const call=useMessagingClient({scope,token,tenantId:tenant?.id,url:process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  const unread=useSupportUnread(call,!!tenant?.id&&!!appUser?.id);
  return {call,scope,...unread};
}
