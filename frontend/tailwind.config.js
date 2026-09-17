/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sentinel: {
          navy: "#0f172a",
          panel: "#1e293b",
          teal: "#14b8a6",
          coral: "#f43f5e",
        },
      },
    },
  },
  plugins: [],
};
