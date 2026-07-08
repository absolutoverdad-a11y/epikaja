export function loadAlpine() {
  if (window.Alpine || document.querySelector("script[data-alpine-loader]")) return;

  const script = document.createElement("script");
  script.defer = true;
  script.dataset.alpineLoader = "true";
  script.src = "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js";
  document.body.appendChild(script);
}
