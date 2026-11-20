import { Template2AuthFrame } from "@nw/template-2/auth-frame";

/** Template 2 ("Glass") — sign in, create an account, reset your password: site-v2's screens in Template 2's frame. */
export default function Template2AuthLayout({ children }: { children: React.ReactNode }) {
  return <Template2AuthFrame>{children}</Template2AuthFrame>;
}
