import type { NextConfig } from "next";
import dotenv from "dotenv";

// Load env vars from monorepo root .env
dotenv.config({ path: "../../.env" });

const nextConfig: NextConfig = {
  // NOTE: `typescript.ignoreBuildErrors` used to be set here because the root
  // monorepo hoists @types/react@18 (booking + portal are still on React 18)
  // while this app is on React 19, which made every Slot/ComponentType boundary
  // error. That is now fixed at the source — tsconfig.json pins `react` and
  // `react-dom` to this app's own @types copies — so `next build` type-checks
  // for real again. Do not re-add the escape hatch; fix the types instead.
};

export default nextConfig;
