'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdminSupportWorkspace } from '@/components/support/AdminSupportWorkspace';
function Inbox(){
  const query=useSearchParams();
  return <AdminSupportWorkspace initialId={query.get('ticket')??undefined}/>;
}
export default function SupportPage(){return <Suspense fallback={<p>Loading Support…</p>}><Inbox/></Suspense>;}
