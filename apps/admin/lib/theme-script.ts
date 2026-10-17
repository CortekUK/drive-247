/** Where the dark/light choice is kept (one key, this browser). */
export const THEME_KEY = 'drive247-admin-theme';

/**
 * Runs inline in <head> before first paint (app/layout.tsx), so a dark-mode
 * user never sees a white flash while React loads. Not a client module: the
 * server layout has to read this string, not a reference to it.
 */
export const THEME_SCRIPT = `try{if(localStorage.getItem('${THEME_KEY}')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;
