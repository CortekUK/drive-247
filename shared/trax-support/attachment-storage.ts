import type { MessagingStorage } from '../../supabase/functions/trax-support/support/messaging';

/** The private bucket support attachments live in. Nothing is public: every read
 *  and write goes through a short-lived signed URL minted for a reserved path. */
export const SUPPORT_ATTACHMENT_BUCKET='trax-support-attachments';
export function attachmentStorage(client:{storage:{from(bucket:string):{
  createSignedUploadUrl(path:string):Promise<{data:{signedUrl:string;token:string}|null;error:unknown}>;
  createSignedUrl(path:string,seconds:number):Promise<{data:{signedUrl:string}|null;error:unknown}>;
}}}):MessagingStorage {
  const bucket=()=>client.storage.from(SUPPORT_ATTACHMENT_BUCKET);
  return {
    signUpload:async(path)=>{const {data,error}=await bucket().createSignedUploadUrl(path);
      if(error||!data)throw new Error('The attachment could not be prepared.');
      return {url:data.signedUrl,token:data.token};},
    signDownload:async(path,seconds)=>{const {data}=await bucket().createSignedUrl(path,seconds);return data?.signedUrl??null;},
  };
}
