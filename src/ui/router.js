export const appRoutes = [
  {
    nombre: "Punto de Venta",
    url: "punto-venta.html",
    rolesPermitidos: ["admin", "vendedor", "visitante"],
    default: true,
  },
  {
    nombre: "Finanzas",
    url: "index.html",
    rolesPermitidos: ["admin", "visitante"],
  },
  {
    nombre: "Inventario",
    url: "inventario.html",
    rolesPermitidos: ["admin", "visitante"],
  },
];

const appState = {
  usuario: null,
  rol: null,
};

export function setCurrentUserRole({ usuario, rol }) {
  appState.usuario = usuario ?? null;
  appState.rol = rol ?? null;
}

export function clearCurrentUserRole() {
  appState.usuario = null;
  appState.rol = null;
}

export function getCurrentRole() {
  return appState.rol;
}

export function isReadOnlyRole(rol = appState.rol) {
  return rol === "visitante";
}

export function getCurrentRouteName(pathname = window.location.pathname) {
  const fileName = pathname.split("/").filter(Boolean).pop();
  return fileName || "index.html";
}

export function getRouteByUrl(url) {
  return appRoutes.find((route) => route.url === url) ?? null;
}

export function getAllowedRoutes(rol = appState.rol) {
  return appRoutes.filter((route) => route.rolesPermitidos.includes(rol));
}

export function hasRoutesForRole(rol = appState.rol) {
  return getAllowedRoutes(rol).length > 0;
}

export function getDefaultRoute(rol = appState.rol) {
  return appRoutes.find((route) => route.default && route.rolesPermitidos.includes(rol))
    ?? getAllowedRoutes(rol)[0]
    ?? appRoutes[0];
}

export function canAccessRoute(url = getCurrentRouteName(), rol = appState.rol) {
  const route = getRouteByUrl(url);
  if (!route) return true;
  return route.rolesPermitidos.includes(rol);
}

export function guardCurrentRoute({
  rol = appState.rol,
  onDenied,
  redirectDelay = 900,
} = {}) {
  const currentRoute = getCurrentRouteName();

  if (canAccessRoute(currentRoute, rol)) {
    return true;
  }

  const fallback = getDefaultRoute(rol);
  const isSelfRedirect = fallback.url === currentRoute;

  onDenied?.({
    currentRoute,
    fallback,
    message: rol
      ? "No tienes permiso para entrar a esta seccion."
      : "Tu usuario no tiene un rol valido configurado.",
  });

  if (!isSelfRedirect) {
    window.setTimeout(() => {
      window.location.replace(`./${fallback.url}`);
    }, redirectDelay);
  }

  return false;
}

export function renderNavbar(container, {
  rol = appState.rol,
  currentRoute = getCurrentRouteName(),
} = {}) {
  if (!container) return;

  const routes = getAllowedRoutes(rol);
  const isMobileOpen = container.dataset.mobileOpen === "true";

  container.className = [
    isMobileOpen ? "flex" : "hidden",
    "absolute left-4 right-4 top-[72px] z-40 flex-col gap-2 rounded-lg bg-white p-3 shadow-lg",
    "md:static md:flex md:flex-row md:items-center md:gap-2 md:bg-transparent md:p-0 md:shadow-none",
  ].join(" ");

  container.innerHTML = routes
    .map((route) => {
      const isActive = route.url === currentRoute;
      const classes = isActive
        ? "bg-green-600 text-white"
        : "bg-gray-100 text-gray-700 hover:bg-gray-200";

      return `
        <a href="./${route.url}" class="inline-flex h-10 w-full items-center justify-center rounded-lg px-3 text-sm font-semibold md:h-9 md:w-auto md:text-xs ${classes}">
          ${route.nombre}
        </a>
      `;
    })
    .join("");

  const toggle = document.querySelector("[data-mobile-menu-toggle]");
  if (!toggle || toggle.dataset.boundMobileMenu === "true") return;

  toggle.dataset.boundMobileMenu = "true";
  toggle.addEventListener("click", () => {
    const nextOpen = container.dataset.mobileOpen !== "true";
    container.dataset.mobileOpen = String(nextOpen);
    toggle.setAttribute("aria-expanded", String(nextOpen));
    renderNavbar(container, {
      rol: appState.rol,
      currentRoute: getCurrentRouteName(),
    });
  });

  container.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    container.dataset.mobileOpen = "false";
    toggle.setAttribute("aria-expanded", "false");
    renderNavbar(container, {
      rol: appState.rol,
      currentRoute: getCurrentRouteName(),
    });
  });
}
