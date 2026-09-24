"use client";

import { useEffect } from "react";

/**
 * The sign-in screen is always light, whatever the operator's portal is set to.
 *
 * Asked for directly (Sep 24 2026): a phone in system dark opened this page
 * dark, and the screen a new operator meets before they have an account is not
 * the place to inherit a preference they have not expressed yet. The theme
 * toggle went with it — there is nothing here worth switching, and switching it
 * pre-auth only changes what the login screen looks like.
 *
 * Why the class is pinned by hand rather than with next-themes' `forcedTheme`:
 * since 0.4 a nested `<ThemeProvider>` is a no-op — its source reads
 * `useContext(ThemeContext) ? children : <Theme…/>`, so a second provider
 * inside `app/providers.tsx`'s one renders its children and nothing else. And
 * `setTheme("light")` is the wrong tool in the other direction: it writes
 * `localStorage.theme`, which would silently change the operator's portal
 * theme for every page after they sign in.
 *
 * The observer is not belt-and-braces. When /login is the first page loaded,
 * this effect and the provider's own mount effects land in the same commit,
 * children first — so the provider re-applies `dark` immediately after a
 * one-shot removal. It also re-applies on an OS theme flip while the stored
 * theme is "system". Re-pinning on each of those is what makes the page hold.
 *
 * Unmount puts back exactly what was there, so signing in lands on a dashboard
 * wearing the operator's own theme.
 */
export function usePinnedLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;

    const pinLight = () => {
      // Guarded so writing never fires the observer into a second pass.
      if (root.classList.contains("dark")) root.classList.remove("dark");
      if (!root.classList.contains("light")) root.classList.add("light");
      if (root.style.colorScheme !== "light") root.style.colorScheme = "light";
    };

    pinLight();
    const observer = new MutationObserver(pinLight);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });

    return () => {
      observer.disconnect();
      if (hadDark) {
        root.classList.add("dark");
        root.classList.remove("light");
      }
      root.style.colorScheme = previousColorScheme;
    };
  }, []);
}
