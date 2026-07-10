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
  const configBase = getAppConfig().apiBaseUrl || "";
  const cleanBase = String(configBase).trim().replace(/\/+$/, "");

  if (cleanBase) {
    return `${cleanBase}${normalizedPath}`;
  }

  return normalizedPath;
}

export function explainLocalApiError(response) {
  if (response.status === 405) {
    return "La API serverless no esta disponible en esta ruta. Revisa apiBaseUrl en app-config.js.";
  }

  return "";
}
