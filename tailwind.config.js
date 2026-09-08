/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--app-bg)",
        surface: "var(--app-surface)",
        control: "var(--app-input)",
        line: "var(--app-line)",
        primary: "var(--app-text)",
        secondary: "var(--app-text-muted)",
        accent: "var(--accent)",
        selected: "var(--app-active)",
      },
    },
  },
  plugins: [],
};
