// NOT a runtime dependency. This config exists only to regenerate the vendored
// tailwind.css after index.html changes (new utility classes won't style
// themselves until you re-run this):
//
//   npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
//
// The theme must stay identical to the brand palette the site was built with.
//
// Every theme.js token is also a colour here, as var(--token), so index.html
// can write text-ink-3, bg-paper or focus:ring-red and get the token itself:
// light and dark both, with no dark-mode bridge rule (2026-10-30). The names
// come from theme.js's own table, so a token added there is a class here on
// the next regen, and no value is ever written twice.
const { THEME_TOKENS } = require("./theme.js");

const tokenColors = {};
for (const name of Object.keys(THEME_TOKENS)) tokenColors[name] = `var(--${name})`;
// red and green are also Tailwind palette names (text-red-600, bg-green-50).
// As { DEFAULT } they extend that palette rather than replace it, so
// text-red is the token and text-red-600 is still Tailwind's.
tokenColors.red = { DEFAULT: "var(--red)" };
tokenColors.green = { DEFAULT: "var(--green)" };

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#FEF2F2", 100: "#FEE2E2", 200: "#FECACA", 300: "#FCA5A5", 400: "#F87171",
          500: "#EF4444", 600: "#DC2626", 700: "#B91C1C", 800: "#991B1B", 900: "#7F1D1D",
        },
        ...tokenColors,
      },
    },
  },
};
