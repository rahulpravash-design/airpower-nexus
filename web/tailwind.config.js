/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050914", bg2: "#0A1222", panel: "#101B2D", panel2: "#16243a",
        cyan: { DEFAULT: "#39D9FF" }, blue: { DEFAULT: "#4385FF" }, green: { DEFAULT: "#45E5AE" },
        amber: { DEFAULT: "#FFBD59" }, red: { DEFAULT: "#FF5D72" },
        ink: "#EDF5FF", muted: "#8DA1BB",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "monospace"],
      },
      boxShadow: { glow: "0 0 0 1px rgba(57,217,255,.35), 0 0 18px rgba(57,217,255,.18)" },
    },
  },
  plugins: [],
};
