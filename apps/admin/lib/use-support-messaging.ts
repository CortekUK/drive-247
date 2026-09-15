'use client';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { useMessagingClient, useSupportUnread } from '../../../shared/trax-support/client';
const token=async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token??null;};
export function useAdminSupport(){
  const {user}=useAuthStore();const scope=JSON.stringify([user?.id,user?.is_super_admin]);
  const call=useMessagingClient({scope,token,admin:true,url:process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  const unread=useSupportUnread(call,!!user?.is_super_admin);return {call,scope,...unread};
}
