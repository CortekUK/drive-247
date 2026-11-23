import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Historical names, kept because 161 call sites across 12 files spell them
        // (bg-dark-card, border-dark-border, text-dark-text-secondary, …) and
        // renaming all of those would be a refactor, not a restyle. What changed
        // is what they RESOLVE to: they were literal hex pinned to the old
        // neon-purple palette, which is why the app could only ever be dark. Each
        // now points at the theme token it was hand-matched to, so they follow
        // :root in light mode and .dark in dark mode like everything else.
        // Read "dark-" as "the surface/border/text token", not as "dark mode".
        "dark-bg": "hsl(var(--background))",
        "dark-card": "hsl(var(--card))",
        "dark-border": "hsl(var(--border))",
        "dark-hover": "hsl(var(--muted))", // hover surface between card and border
        "dark-text": "hsl(var(--foreground))",
        "dark-text-secondary": "hsl(var(--muted-foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
          muted: "hsl(var(--sidebar-muted))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      /* ------------------------------------------------------------------
       * The v2 radius ramp.
       *
       * `improv/portal-side` runs Tailwind v4 and derives its whole radius
       * scale from `--radius` inside `@theme`:
       *     sm 0.6x  md 0.8x  lg 1x  xl 1.4x  2xl 1.8x  3xl 2.2x  4xl 2.6x
       * At the v2 `--radius` of 0.625rem the three keys below already agree
       * with that — `calc(--radius - 4px)` and `--radius * 0.6` are both 6px,
       * `- 2px` and `* 0.8` are both 8px — which is why only the larger steps
       * needed adding. v3 resolves `rounded-*` here at BUILD time, so these
       * could not ride along with the custom properties in globals.css; each
       * reads a `--v2-radius-*` set in exactly one place, that file's `:root`.
       *
       * `4xl` is different in kind: v3 has no such key, so `rounded-4xl`
       * compiled to nothing at all. It is the radius v2 draws every card,
       * button and dialog with, so it is added rather than overridden. The
       * fallbacks are the values v3 already emitted (and v4's own 2rem for
       * `4xl`), which keeps the utilities sane if --radius is ever unset.
       * ------------------------------------------------------------------ */
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "var(--v2-radius-xl, 0.75rem)",
        "2xl": "var(--v2-radius-2xl, 1rem)",
        "3xl": "var(--v2-radius-3xl, 1.5rem)",
        "4xl": "var(--v2-radius-4xl, 2rem)",
      },
      /* v3's ring scale is 0/1/2/4/8, so v2's `ring-3` focus rings would
         compile to nothing. Purely additive — no `ring-3` existed before, so
         no existing markup starts resolving differently. */
      ringWidth: {
        3: "3px",
      },
      /* v4 renumbered the blur ramp: its `blur-sm` is 8px where v3's is 4px
         (v3's 4px became v4's `blur-xs`). Without this every v2 scrim — dialog,
         sheet, drawer — is half as blurred as the design. */
      backdropBlur: {
        sm: "var(--v2-backdrop-blur-sm, 4px)",
      },
      /* v4 shifted the shadow ramp up one step as well: what it calls
         `shadow-sm` is v3's `shadow`. The v2 primitives are drawn against the
         v4 value, so `shadow-sm` is pinned to it here. */
      boxShadow: {
        sm: "var(--v2-shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05))",
      },
      fontFamily: {
        // Manrope is the v2 typeface, loaded by next/font in app/layout.tsx —
        // which is also why the render-blocking Google Fonts @import that used
        // to head globals.css is gone. The fallbacks cover the frame before the
        // font file lands and any context where the variable is unset.
        sans: ['var(--font-manrope)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
