import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // The editor and every widget live under lib/, not app/. Without this the
    // layout classes that appear only there are never generated, and the editor
    // renders as one unstyled column with no preview pane.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          900: "#0a0a0a",
          800: "#141414",
          700: "#1c1c1c",
          600: "#2a2a2a",
        },
        accent: {
          DEFAULT: "#ffffff",
          hover: "#d4d4d4",
        },
      },
    },
  },
  plugins: [],
};

export default config;
