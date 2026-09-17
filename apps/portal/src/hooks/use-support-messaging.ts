'use client';
import { useCallback } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { supabase } from '@/integrations/supabase/client';
import { useMessagingClient, useSupportUnread } from '../../../../shared/trax-support/client';
import { SUPPORT_ATTACHMENT_BUCKET } from '../../../../shared/trax-support/attachment-storage';
const token=async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token??null;};
export function useSupportMessaging(){
  const {tenant}=useTenant();const {appUser,user}=useAuthStore();const {permissions}=useManagerPermissions();
  const scope=JSON.stringify([tenant?.id,user?.id,appUser?.id,appUser?.role,appUser?.is_active,permissions]);
  const call=useMessagingClient({scope,token,tenantId:tenant?.id,url:process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  const unread=useSupportUnread(call,!!tenant?.id&&!!appUser?.id);
  /* The file goes straight to private storage with the one-time URL the server
     reserved for it; it never passes through the support API. */
  const uploadAttachment=useCallback(async(upload:{url:string;token:string;path:string},file:File)=>{
    const {error}=await supabase.storage.from(SUPPORT_ATTACHMENT_BUCKET).uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type});
    if(error)throw new Error('That file could not be uploaded. Your message has not been sent.');
  },[]);
  return {call,scope,uploadAttachment,...unread};
}
