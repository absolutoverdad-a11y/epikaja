const storageKey = "epika-theme";

const moonIcon = `
  <svg class="h-4 w-4" aria-hidden="true" viewBox="0 0 24 24">
    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20.99 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.78 9.79Z"></path>
  </svg>
`;

const sunIcon = `
  <svg class="h-4 w-4" aria-hidden="true" viewBox="0 0 24 24">
    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 1v2m0 18v2m7.78-18.78-1.42 1.42M5.64 18.36l-1.42 1.42M23 12h-2M3 12H1m18.78 7.78-1.42-1.42M5.64 5.64 4.22 4.22M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"></path>
  </svg>
`;

function getSystemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme() {
  return localStorage.getItem(storageKey);
}

export function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  const isDark = normalizedTheme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  localStorage.setItem(storageKey, normalizedTheme);
  syncThemeButtons(normalizedTheme);
}

export function initTheme() {
  applyTheme(getStoredTheme() || getSystemTheme());
}

export function toggleTheme() {
  const nextTheme = document.documentElement.classList.contains("dark") ? "light" : "dark";
  applyTheme(nextTheme);
}

export function bindThemeToggle(selector = "[data-theme-toggle]") {
  document.querySelectorAll(selector).forEach((button) => {
    if (button.dataset.themeBound === "true") return;
    button.dataset.themeBound = "true";
    button.addEventListener("click", toggleTheme);
  });

  syncThemeButtons(document.documentElement.classList.contains("dark") ? "dark" : "light");
}

function syncThemeButtons(theme) {
  const isDark = theme === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.title = isDark ? "Cambiar a claro" : "Cambiar a oscuro";
    button.setAttribute("aria-label", isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");

    const icon = button.querySelector("[data-theme-icon]");
    if (icon) icon.innerHTML = isDark ? sunIcon : moonIcon;
  });

  const legacyIcon = document.querySelector("#themeToggleIcon");
  if (legacyIcon) legacyIcon.setAttribute("href", isDark ? "#icon-sun" : "#icon-moon");
}
