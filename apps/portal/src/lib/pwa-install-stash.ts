/**
 * Inline <head> script, run before any bundle (the root layout renders it for v2).
 *
 * Chrome fires `beforeinstallprompt` once and early, often before React has
 * mounted: on Nov 9 2026 the customer site's listener, armed only once the
 * tenant row had loaded, missed it, and Settings › Install app never showed its
 * button. The portal's registrar waits for the tenant row too. The script parks
 * the event on `window.__pwaInstallPrompt` and suppresses Chrome's own
 * mini-infobar, so the install happens from our button; the helpers in
 * `lib/push.ts` (`adoptStashedInstallPrompt`) pick it up from there.
 *
 * Plain ES5 in a string, with no imports, so the layout can inline it without
 * pulling browser-only modules into its bundle.
 */
export const PWA_INSTALL_PROMPT_STASH_SCRIPT =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaInstallPrompt=e;});" +
  "window.addEventListener('appinstalled',function(){window.__pwaInstallPrompt=null;});";
