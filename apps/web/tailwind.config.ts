import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        // Unified brand accent (TrustMCP blue), used app-wide. The 600 is the
        // canonical brand color; 700 is its hover, 300 the soft tint.
        brand: {
          50: "#eef1fe",
          100: "#e0e5fd",
          200: "#c4ccfb",
          300: "#a5b4fc",
          400: "#7587f7",
          500: "#4a5ef1",
          600: "#1837ec",
          700: "#1430cf",
          800: "#1528a1",
          900: "#16276b",
          DEFAULT: "#1837ec",
          fg: "#ffffff",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
