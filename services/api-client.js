const apiBaseStorageKey = "EPIKA_API_BASE_URL";

export function getAppConfig() {
  return window.EPIKA_CONFIG || {};
}

export function getRuntimeMode() {
  return String(getAppConfig().runtime || getAppConfig().modo || "static").trim().toLowerCase();
}

export function usesServerlessApi(feature = "") {
  const config = getAppConfig();
  const featureMode = feature ? config[feature]?.mode : "";
  return String(featureMode || config.apiMode || getRuntimeMode()).trim().toLowerCase() === "serverless";
}

export function getApiUrl(path) {
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  const configBase = window.EPIKA_CONFIG?.apiBaseUrl || window.EPIKA_API_BASE_URL || "";
  const overrideBase = localStorage.getItem(apiBaseStorageKey) || configBase;
  const cleanBase = String(overrideBase).trim().replace(/\/+$/, "");

  if (cleanBase) {
    return `${cleanBase}${normalizedPath}`;
  }

  return normalizedPath;
}

export function explainLocalApiError(response) {
  const isLiveServer = ["127.0.0.1:5500", "localhost:5500"].includes(window.location.host);

  if (isLiveServer && response.status === 405) {
    return [
      "Live Server no ejecuta /api.",
      "Abre la app con el servidor local del proyecto o configura app-config.js con un apiBaseUrl.",
    ].join(" ");
  }

  return "";
}
