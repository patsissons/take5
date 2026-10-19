// Applies the theme before first paint so there is no flash. Loaded as a
// blocking external script because the CSP forbids inline scripts. Mirrors
// src/lib/theme.ts (key, media query, theme-color values), which takes over
// once the app loads: change both together.
(function () {
  var theme;
  try {
    theme = localStorage.getItem("take5:theme");
  } catch (e) {}
  if (theme !== "light" && theme !== "dark") {
    theme = matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  var root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute("content", theme === "dark" ? "#0d0f17" : "#f9f9fb");
})();
