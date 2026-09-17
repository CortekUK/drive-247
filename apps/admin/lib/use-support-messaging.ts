'use client';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { useCallback } from 'react';
import { useMessagingClient, useSupportUnread } from '../../../shared/trax-support/client';
import { SUPPORT_ATTACHMENT_BUCKET } from '../../../shared/trax-support/attachment-storage';
const token=async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token??null;};
export function useAdminSupport(){
  const {user}=useAuthStore();const scope=JSON.stringify([user?.id,user?.is_super_admin]);
  const call=useMessagingClient({scope,token,admin:true,url:process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  const unread=useSupportUnread(call,!!user?.is_super_admin);
  /* Support's own file goes to the same private bucket, through the one-time URL
     the server reserved for it. */
  const uploadAttachment=useCallback(async(upload:{url:string;token:string;path:string},file:File)=>{
    const {error}=await supabase.storage.from(SUPPORT_ATTACHMENT_BUCKET).uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type});
    if(error)throw new Error('That file could not be uploaded. Your message has not been sent.');
  },[]);
  return {call,scope,uploadAttachment,...unread};
}
