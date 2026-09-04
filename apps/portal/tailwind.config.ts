import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1.5rem",  /* 24px padding as per Drive247 */
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Playfair Display", "serif"],
        // v2 only. Additive: no v1 component uses `font-heading` (verified by
        // grep across apps/portal/src), so this changes no existing rendering.
        // Falls back to the system stack wherever --font-manrope is undefined,
        // which is every tenant not gated into the v2 theme.
        heading: [
          "var(--font-manrope)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          light: "hsl(var(--primary-light))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          light: "hsl(var(--destructive-light))",
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
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          light: "hsl(var(--success-light))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          light: "hsl(var(--warning-light))",
        },
      },
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-success": "var(--gradient-success)",
        "gradient-warning": "var(--gradient-warning)",
        "gradient-subtle": "var(--gradient-subtle)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        card: "var(--shadow-card)",
        hover: "var(--shadow-hover)",
      },
      spacing: {
        '14': '3.5rem',
        '56': '14rem',  /* 56px header height */
        'header': 'var(--header-height)',
        'sidebar': 'var(--sidebar-width)',
        'sidebar-collapsed': 'var(--sidebar-collapsed-width)',
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",

        /* ------------------------------------------------------------------
         * The v2 radius ramp, wired so it is INERT for the other 56 tenants.
         *
         * `improv/portal-side` runs Tailwind v4 and derives its whole radius
         * scale from `--radius` inside `@theme`:
         *     sm 0.6x   md 0.8x   lg 1x   xl 1.4x   2xl 1.8x   3xl 2.2x   4xl 2.6x
         * `sm`/`md`/`lg` already agree with the three keys above — at the v2
         * `--radius` of 0.625rem, `calc(--radius - 4px)` and `--radius * 0.6`
         * are both 6px, `- 2px` and `* 0.8` are both 8px — which is why the
         * colour-only port looked right at the small end and wrong everywhere
         * a card, dialog, sheet or pill used a larger step.
         *
         * v3 resolves `rounded-*` from THIS file at BUILD time, not from a CSS
         * variable, so `xl`/`2xl`/`3xl` could not ride along with the colour
         * custom properties that were scoped into `.v2-theme`. Each therefore
         * reads a `--v2-radius-*` property that is set in EXACTLY ONE place —
         * the `.v2-theme` block in src/styles/v2-theme.css, which lands on
         * <body> only for tenants gated into the `theme` v2 area (lib/v2.ts).
         * The fallback is byte-for-byte the value Tailwind v3 already emitted,
         * so for every other tenant the COMPUTED radius is unchanged; only the
         * CSS text differs. Nothing here is redefined to a new constant.
         *
         * `4xl` is different in kind: v3 has no such key, so `rounded-4xl`
         * compiled to nothing at all and the port had to substitute
         * `rounded-[2rem]` (32px) for the branch's 26px on every card, button,
         * dialog, drawer and command palette. This adds the utility rather than
         * overriding one, and its fallback is Tailwind v4's own default (2rem)
         * so a non-v2 caller would get the upstream value.
         * ------------------------------------------------------------------ */
        xl: "var(--v2-radius-xl, 0.75rem)",
        "2xl": "var(--v2-radius-2xl, 1rem)",
        "3xl": "var(--v2-radius-3xl, 1.5rem)",
        "4xl": "var(--v2-radius-4xl, 2rem)",
      },
      /* v3's ring scale is 0/1/2/4/8, so the branch's `ring-3` focus rings
         compiled to nothing and the port downgraded all of them to `ring-2`.
         Purely additive — no utility named `ring-3` existed before, so no
         existing markup anywhere can start resolving differently. */
      ringWidth: {
        3: "3px",
      },
      /* v4 renumbered the blur ramp: its `blur-sm` is 8px where v3's is 4px
         (v4's 4px moved to the new `blur-xs`). Every v2 scrim — dialog, sheet,
         drawer, alert-dialog, the announcement carousel — was therefore half as
         blurred as the design. Same inert-by-fallback wiring as the radii. */
      backdropBlur: {
        sm: "var(--v2-backdrop-blur-sm, 4px)",
      },
      transitionProperty: {
        'all': 'var(--transition-all)',
        'smooth': 'var(--transition-smooth)',
      },
      scale: {
        '102': '1.02',  /* Hover scale for cards */
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        /* Radix Collapsible — used by the banner stack's overflow row.
           Mirrors the accordion pair above; Radix exposes the measured height
           on a different custom property, hence the near-duplicate. */
        "collapsible-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-collapsible-content-height)",
          },
        },
        "collapsible-up": {
          from: {
            height: "var(--radix-collapsible-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "border-rotate": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" }
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" }
        },
        "glow": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "0.8" }
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" }
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.9", transform: "scale(0.98)" }
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        "wiggle": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-12deg)" },
          "75%": { transform: "rotate(12deg)" }
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
        "border-rotate": "border-rotate 6s linear infinite",
        "float": "float 3s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite",
        "spin-slow": "spin-slow 3s linear infinite",
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "slide-up": "slide-up 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;