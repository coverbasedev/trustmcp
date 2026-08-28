import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,mdx}", "./mdx-components.tsx"],
  theme: {
    extend: {
      colors: {
        // Unified brand accent (TrustMCP blue), shared with the web app.
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
    },
  },
  plugins: [],
} satisfies Config;
