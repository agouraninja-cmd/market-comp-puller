// NOT a runtime dependency. This config exists only to regenerate the vendored
// tailwind.css after index.html changes (new utility classes won't style
// themselves until you re-run this):
//
//   npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
//
// The theme must stay identical to the brand palette the site was built with.
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
      },
    },
  },
};
