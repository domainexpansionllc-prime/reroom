/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F8F6F1",
        ink: "#1F2A24",
        muted: "#5B665F",
        line: "#E3DED3",
        sand: "#EFEAE0",
        moss: { DEFAULT: "#2F5D46", dark: "#244936", light: "#E5EEE8" },
        danger: { DEFAULT: "#B3261E", light: "#FDF1F0" },
      },
      fontFamily: {
        serif: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
