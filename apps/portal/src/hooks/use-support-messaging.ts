'use client';
import { useCallback } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { supabase } from '@/integrations/supabase/client';
import { useMessagingClient, useSupportUnread } from '../../../../shared/trax-support/client';
import { SUPPORT_ATTACHMENT_BUCKET } from '../../../../shared/trax-support/attachment-storage';
const token=async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token??null;};

/**
 * The signed-in operator's authenticated client for human support.
 *
 * `scope` is everything the data belongs to — tenant, user, staff row, role, active
 * flag and manager grants. When any of it changes (another tenant, a sign-out, a
 * permission change) the client aborts what is in flight and every count and list
 * built on it starts again from "unknown", so nothing from the previous account is
 * shown or counted.
 */
export function useSupportClient(){
  const {tenant}=useTenant();const {appUser,user}=useAuthStore();const {permissions}=useManagerPermissions();
  const scope=JSON.stringify([tenant?.id,user?.id,appUser?.id,appUser?.role,appUser?.is_active,permissions]);
  const call=useMessagingClient({scope,token,tenantId:tenant?.id,url:process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  /* The file goes straight to private storage with the one-time URL the server
     reserved for it; it never passes through the support API. */
  const uploadAttachment=useCallback(async(upload:{url:string;token:string;path:string},file:File)=>{
    const {error}=await supabase.storage.from(SUPPORT_ATTACHMENT_BUCKET).uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type});
    if(error)throw new Error('That file could not be uploaded. Your message has not been sent.');
  },[]);
  return {call,scope,uploadAttachment,enabled:!!tenant?.id&&!!appUser?.id};
}

/**
 * Unread messages from Drive247 Support for the signed-in operator — the sidebar's
 * Support badge. A count of MESSAGES across their own tickets, computed by the
 * server from stored messages and read state (see `unreadMessageReader`); `null`
 * until it is known, and whenever it cannot be.
 *
 * Refreshed every 10 seconds while the tab is visible, and at once on focus, on
 * reconnect, on returning to the tab and when a conversation marks messages read.
 */
export function useSupportUnreadMessages(){
  const {call,enabled}=useSupportClient();
  return useSupportUnread(call,enabled,{field:'unreadMessages',interval:10000});
}
