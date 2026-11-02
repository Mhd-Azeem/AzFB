export type Theme = "dark" | "light";
const key = "az-leads-theme";
export function savedTheme(): Theme {
  try {
    return localStorage.getItem(key) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f3f6fc" : "#080e1b");
}
export function saveTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(key, theme);
  } catch {
    /* Still applies for this session. */
  }
}
applyTheme(savedTheme());
window.addEventListener("storage", (event) => {
  if (event.key === key || event.key === null) applyTheme(savedTheme());
});
