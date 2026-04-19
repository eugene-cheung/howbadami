import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        /**
         * Cursor-style dark UI (warm neutrals + brand orange).
         * Light-theme tokens in DESIGN.md; this app ships dark-first.
         */
        hb: {
          base: "#090908",
          fg: "#e9e7e2",
          panel: "#121211",
          raised: "#1c1c19",
          inset: "#0e0e0d",
          accent: "#f54e00",
          crimson: "#ff7a88",
          gold: "#c08532",
          success: "#42b38a",
          peach: "#c9886d",
          sage: "#9fc9a2",
          read: "#9fbbe0",
          edit: "#c0a8dd",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-newsreader)", "Georgia", "ui-serif", "serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        display: "-0.04em",
        section: "-0.02em",
      },
      boxShadow: {
        "hb-ring": "0 0 0 1px rgba(255,255,255,0.06)",
        "hb-card":
          "0 24px 72px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05)",
        "hb-soft": "0 0 32px rgba(0,0,0,0.45)",
        "hb-focus": "0 0 0 2px rgba(245,78,0,0.45)",
      },
    },
  },
  plugins: [],
} satisfies Config;
