// The v2 navigation icons live in shared/portal-v2/nav-icons, so the customer
// portal's rail draws the very same set. The stylesheet (the hover gestures)
// is imported here, where the operator app loads it; the customer site
// compiles it into its own stylesheet (northwind-site/styles/site.css).
import "../../../../../shared/portal-v2/nav-icons/nav-icons.css";

export * from "../../../../../shared/portal-v2/nav-icons/nav-icons";
