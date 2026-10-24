import {
  buscarProductoPorCodigo,
  listenAuth,
  loginWithGoogle,
  logout,
} from "../services/productos.js";
import { getUsuarioPerfil } from "../services/usuarios.js";
import { explainLocalApiError, getApiUrl, usesServerlessApi } from "../services/api-client.js";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase-config.js";
import {
  clearCurrentUserRole,
  guardCurrentRoute,
  hasRoutesForRole,
  isReadOnlyRole,
  renderNavbar,
  setCurrentUserRole,
} from "../src/ui/router.js";
import { DEFAULT_PRODUCT_IMAGE_URL, normalizeCode } from "../logic/inventario-utils.js";
import { loadAlpine } from "./alpine-loader.js";
import { bindThemeToggle, initTheme } from "./theme.js";

let currentUser = null;
let alpineBooted = false;
let html5QrCode = null;
let scannerRunning = false;
let processingScan = false;
let scannedProduct = null;
let cart = [];
const cartStoragePrefix = "epika-pos-cart";

const $ = (selector) => document.querySelector(selector);

const loginScreen = $("#loginScreen");
const appShell = $("#appShell");
const loginGoogle = $("#loginGoogle");
const logoutGoogle = $("#logoutGoogle");
const loginError = $("#loginError");
const appNav = $("#appNav");
const toast = $("#toast");
const openScanner = $("#openScanner");
const scannerModal = $("#scannerModal");
const closeScanner = $("#closeScanner");
const scannerStatus = $("#scannerStatus");
const scannerReaderWrapper = $("#scannerReaderWrapper");
const scanProductCard = $("#scanProductCard");
const scanProductName = $("#scanProductName");
const scanProductImage = $("#scanProductImage");
const scanProductCode = $("#scanProductCode");
const scanProductPrice = $("#scanProductPrice");
const scanProductStock = $("#scanProductStock");
const addScannedProduct = $("#addScannedProduct");
const ignoreScannedProduct = $("#ignoreScannedProduct");
const scanErrorCard = $("#scanErrorCard");
const scanErrorCode = $("#scanErrorCode");
const retryScan = $("#retryScan");
const cartSummary = $("#cartSummary");
const cartItemsCount = $("#cartItemsCount");
const cartPiecesCount = $("#cartPiecesCount");
const cartTotal = $("#cartTotal");
const cartList = $("#cartList");
const checkoutButton = $("#checkoutButton");

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

function clearLoginError() {
  loginError.textContent = "";
  loginError.classList.add("hidden");
}

function showToast(message, variant = "error") {
  toast.textContent = message;
  toast.className = `fixed bottom-4 left-4 right-4 z-[60] rounded-lg px-4 py-3 text-sm font-semibold shadow-lg sm:left-auto sm:w-96 ${
    variant === "error" ? "bg-red-600 text-white" : "bg-green-600 text-white"
  }`;

  toast.classList.remove("hidden"); // Asegura remover la clase oculta antes de disparar el timer
  window.setTimeout(() => toast.classList.add("hidden"), 2500);
}

function setScannerStatus(message, variant = "info") {
  scannerStatus.textContent = message;
  scannerStatus.className = `rounded-lg px-4 py-3 text-sm font-semibold ${
    variant === "error" ? "bg-red-600 text-white" : "bg-white/10 text-white"
  }`;
}

function hideScanResults() {
  scannedProduct = null;
  scanProductCard.classList.add("hidden");
  scanErrorCard.classList.add("hidden");
}

function getCartStorageKey() {
  return `${cartStoragePrefix}:${currentUser?.uid || "local"}`;
}

function sanitizeCartItem(item) {
  return {
    id: String(item.id ?? item.codigoBarras ?? "").trim(),
    codigoBarras: String(item.codigoBarras ?? item.id ?? "").trim(),
    nombre: String(item.nombre ?? "Producto sin nombre").trim(),
    precioVenta: Number(item.precioVenta || 0),
    stock: Number(item.stock || 0),
    talla: String(item.talla ?? "").trim(),
    tipoPrenda: String(item.tipoPrenda ?? "").trim(),
    color: String(item.color ?? "").trim(),
    ubicacion: String(item.ubicacion ?? "").trim(),
    imagenUrl: String(item.imagenUrl || DEFAULT_PRODUCT_IMAGE_URL).trim(),
    cantidad: Math.max(1, Number.parseInt(item.cantidad, 10) || 1),
  };
}

function saveCartToStorage() {
  try {
    const key = getCartStorageKey();

    if (cart.length === 0) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(cart.map(sanitizeCartItem)));
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar el carrito en este navegador.", "error");
  }
}

function loadCartFromStorage() {
  try {
    const rawCart = localStorage.getItem(getCartStorageKey());
    if (!rawCart) {
      cart = [];
      return;
    }

    const parsedCart = JSON.parse(rawCart);
    cart = Array.isArray(parsedCart)
      ? parsedCart.map(sanitizeCartItem).filter((item) => item.codigoBarras && item.cantidad > 0)
      : [];
  } catch (error) {
    console.error(error);
    cart = [];
    showToast("No se pudo recuperar el carrito guardado.", "error");
  }
}

function clearCartStorage() {
  try {
    localStorage.removeItem(getCartStorageKey());
  } catch (error) {
    console.error(error);
  }
}

function renderCart() {
  const itemCount = cart.length;
  const pieces = cart.reduce((sum, item) => sum + item.cantidad, 0);
  const total = cart.reduce((sum, item) => sum + item.cantidad * Number(item.precioVenta || 0), 0);

  cartSummary.textContent = `${itemCount} productos en la compra`;
  cartItemsCount.textContent = String(itemCount);
  cartPiecesCount.textContent = String(pieces);
  cartTotal.textContent = moneyFormatter.format(total);
  if (checkoutButton) {
    const readOnly = isReadOnlyRole();
    checkoutButton.classList.toggle("hidden", readOnly);
    checkoutButton.disabled = readOnly || cart.length === 0;
    checkoutButton.textContent = cart.length === 0 ? "Cobrar Venta" : `Cobrar ${moneyFormatter.format(total)}`;
  }

  if (cart.length === 0) {
    cartList.innerHTML = '<div class="px-5 py-8 text-center text-sm text-gray-500">Aun no hay productos en la compra.</div>';
    return;
  }

  cartList.innerHTML = cart
    .map((item) => {
      const subtotal = Number(item.precioVenta || 0) * item.cantidad;
      const imageUrl = item.imagenUrl || DEFAULT_PRODUCT_IMAGE_URL;

      return `
        <article class="grid grid-cols-[72px_1fr] gap-3 px-5 py-4 sm:grid-cols-[72px_1fr_auto_auto] sm:items-center">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.nombre || "Producto")}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMAGE_URL}'" class="h-[72px] w-[72px] rounded-lg bg-gray-100 object-cover">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-gray-950">${escapeHtml(item.nombre)}</p>
              <span class="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">${escapeHtml(item.codigoBarras ?? item.id)}</span>
            </div>
            <p class="mt-1 text-sm text-gray-600">${moneyFormatter.format(item.precioVenta || 0)} x ${item.cantidad}</p>
            <p class="mt-1 text-xs text-gray-400">Stock disponible: ${Number(item.stock || 0)}</p>
          </div>
          <p class="text-right font-bold text-green-600">${moneyFormatter.format(subtotal)}</p>
          <button type="button" data-remove-cart="${escapeHtml(item.codigoBarras ?? item.id)}" class="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">
            Quitar
          </button>
        </article>
      `;
    })
    .join("");
}

function addProductToCart(producto) {
  const code = String(producto.codigoBarras ?? producto.id ?? "").trim();
  const existing = cart.find((item) => String(item.codigoBarras ?? item.id) === code);
  const stock = Number(producto.stock || 0);

  if (existing) {
    if (stock > 0 && existing.cantidad >= stock) {
      showToast("No hay mas stock disponible para este producto.", "error");
      return false;
    }

    existing.cantidad += 1;
  } else {
    if (stock <= 0) {
      showToast("Este producto esta agotado.", "error");
      return false;
    }

    cart.push({
      ...producto,
      cantidad: 1,
    });
  }

  renderCart();
  saveCartToStorage();
  return true;
}

async function cobrarVentaEnServidor() {
  if (!currentUser) throw new Error("Inicia sesion para cobrar.");

  const token = await currentUser.getIdToken();
  const response = await fetch(getApiUrl("/api/cobrar-venta"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      cart: cart.map((item) => ({
        codigoBarras: item.codigoBarras ?? item.id,
        cantidad: item.cantidad,
      })),
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(explainLocalApiError(response) || result?.error || "No se pudo procesar la venta.");
  }

  return result;
}

async function cobrarVentaEnCliente() {
  if (!currentUser) throw new Error("Inicia sesion para cobrar.");

  await runTransaction(db, async (transaction) => {
    const transaccionesRef = doc(collection(db, "transacciones"));
    let totalVenta = 0;
    let totalPiezas = 0;
    const productosUpdates = [];
    const prendasVendidas = [];

    for (const item of cart) {
      const codigo = String(item.codigoBarras ?? item.id ?? "").trim();
      const productRef = doc(db, "productos", codigo);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        throw new Error(`El producto ${item.nombre || codigo} no existe en inventario.`);
      }

      const producto = productSnap.data();
      const currentStock = Number(producto.stock || 0);
      const cantidad = Number(item.cantidad || 0);
      const precioUnitario = Number(producto.precioVenta || item.precioVenta || 0);

      if (currentStock < cantidad) {
        throw new Error(`Stock insuficiente para ${producto.nombre || item.nombre || codigo}. Disponible: ${currentStock}`);
      }

      const subtotal = Math.round(precioUnitario * cantidad * 100) / 100;
      totalVenta += subtotal;
      totalPiezas += cantidad;

      productosUpdates.push({ ref: productRef, stock: currentStock - cantidad });
      prendasVendidas.push({
        codigo,
        nombre: String(producto.nombre || item.nombre || "Producto sin nombre"),
        cantidad,
        precioUnitario,
        subtotal,
      });
    }

    productosUpdates.forEach((update) => {
      transaction.update(update.ref, { stock: update.stock });
    });

    transaction.set(transaccionesRef, {
      tipo: "ingreso_corte",
      monto: Math.round(totalVenta * 100) / 100,
      concepto: `Venta POS: ${totalPiezas} prendas`,
      cuenta: "caja",
      prendas: prendasVendidas,
      ingresoExtra: null,
      origen: "pos",
      usuarioUid: currentUser.uid,
      usuarioEmail: currentUser.email,
      fecha: serverTimestamp(),
    });
  });
}

async function cobrarVenta() {
  if (usesServerlessApi("pos")) {
    return cobrarVentaEnServidor();
  }

  return cobrarVentaEnCliente();
}

async function stopScanner() {
  processingScan = false;

  if (!html5QrCode || !scannerRunning) return;

  try {
    await html5QrCode.stop();
  } catch (error) {
    console.error(error);
  } finally {
    scannerRunning = false;
  }
}

async function startScanner() {
  if (!window.Html5Qrcode) {
    setScannerStatus("No se pudo cargar la libreria del escaner.", "error");
    return;
  }

  hideScanResults();
  scannerReaderWrapper.classList.remove("hidden");
  setScannerStatus("Activando camara...");

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("scannerReader");
  }

  try {
    const formatsToSupport = getScannerFormats();
    scannerRunning = true;
    processingScan = false;

    // --- CAMBIO CLAVE: SE ELIMINARON LAS RESTRICCIONES DE DIMENSIONES (ASPECTRATIO Y QRBOX) ---
    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        ...(formatsToSupport.length > 0 ? { formatsToSupport } : {}),
      },
      onScanSuccess,
      () => {}
    );

    setScannerStatus("Escáner activo. Coloca el código frente a la cámara.");
  } catch (error) {
    scannerRunning = false;
    console.error(error);
    setScannerStatus("No se pudo abrir la camara. Revisa permisos.", "error");
  }
}

function getScannerFormats() {
  const formats = window.Html5QrcodeSupportedFormats;
  if (!formats) return [];

  return [
    formats.EAN_13,
    formats.EAN_8,
    formats.UPC_A,
    formats.UPC_E,
    formats.CODE_128,
    formats.CODE_39,
    formats.CODE_93,
    formats.ITF,
    formats.QR_CODE,
  ].filter((format) => format !== undefined);
}

async function onScanSuccess(decodedText) {
  if (processingScan) return;
  processingScan = true;

  const scannedCode = String(decodedText ?? "").trim();
  if (!scannedCode) {
    processingScan = false;
    return;
  }

  setScannerStatus(`Codigo detectado: ${scannedCode}`);
  await stopScanner();
  scannerReaderWrapper.classList.add("hidden");
  await validateScannedCode(scannedCode);
}

async function validateScannedCode(scannedCode) {
  const normalizedCode = normalizeCode(scannedCode);

  try {
    const producto = await buscarProductoPorCodigo(scannedCode)
      || (normalizedCode !== scannedCode ? await buscarProductoPorCodigo(normalizedCode) : null);

    if (!producto) {
      showScanError(scannedCode);
      return;
    }

    showScannedProduct(producto);
  } catch (error) {
    console.error(error);
    showScanError(scannedCode, "No se pudo validar el producto.");
  }
}

function showScannedProduct(producto) {
  scannedProduct = producto;
  scanProductImage.src = producto.imagenUrl || DEFAULT_PRODUCT_IMAGE_URL;
  scanProductImage.onerror = () => {
    scanProductImage.onerror = null;
    scanProductImage.src = DEFAULT_PRODUCT_IMAGE_URL;
  };
  scanProductName.textContent = producto.nombre || "Producto sin nombre";
  scanProductCode.textContent = producto.codigoBarras || producto.id || "";
  scanProductPrice.textContent = moneyFormatter.format(producto.precioVenta || 0);
  scanProductStock.textContent = String(Number(producto.stock || 0));
  addScannedProduct.classList.toggle("hidden", isReadOnlyRole());
  scanErrorCard.classList.add("hidden");
  scanProductCard.classList.remove("hidden");
  setScannerStatus("Camara pausada. Valida el producto.");
}

function showScanError(code, message = "El codigo no existe") {
  scannedProduct = null;
  scanErrorCode.textContent = code;
  scanProductCard.classList.add("hidden");
  scanErrorCard.classList.remove("hidden");
  setScannerStatus(message, "error");
}

async function openScannerModal() {
  scannerModal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
  await startScanner();
}

async function closeScannerModal() {
  await stopScanner();
  hideScanResults();
  scannerReaderWrapper.classList.remove("hidden");
  scannerModal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
}

async function resumeScanner() {
  hideScanResults();
  await startScanner();
}

function bootPuntoVentaApp() {
  if (alpineBooted) return;
  alpineBooted = true;

  initTheme();
  bindThemeToggle();

  loginGoogle.addEventListener("click", async () => {
    clearLoginError();
    try {
      await loginWithGoogle();
    } catch (error) {
      console.error(error);
      showLoginError("No se pudo iniciar sesion con Google.");
    }
  });

  logoutGoogle.addEventListener("click", async () => {
    await closeScannerModal();
    await logout();
  });

  openScanner.addEventListener("click", openScannerModal);
  closeScanner.addEventListener("click", closeScannerModal);
  retryScan.addEventListener("click", resumeScanner);
  ignoreScannedProduct.addEventListener("click", resumeScanner);

  addScannedProduct.addEventListener("click", async () => {
    if (!scannedProduct) return;

    const wasAdded = addProductToCart(scannedProduct);
    if (wasAdded) showToast("Producto agregado a la compra.", "success");
    await resumeScanner();
  });

cartList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-cart]");
  if (!button) return;

  cart = cart.filter((item) => String(item.codigoBarras ?? item.id) !== button.dataset.removeCart);
  renderCart();
  saveCartToStorage();
});

  if (checkoutButton) {
    checkoutButton.addEventListener("click", async () => {
      if (cart.length === 0) {
        showToast("El carrito esta vacio.", "error");
        return;
      }

      checkoutButton.disabled = true;
      checkoutButton.textContent = "Procesando...";

      try {
        await cobrarVenta();
        showToast("Compra cobrada con exito e inventario actualizado.", "success");
        cart = [];
        clearCartStorage();
        renderCart();
      } catch (error) {
        console.error("Error en cobro de venta:", error);
        showToast(error.message || "No se pudo procesar la venta.", "error");
      } finally {
        renderCart();
      }
    });
  }

  listenAuth(async (user) => {
    currentUser = null;
    cart = [];
    clearCurrentUserRole();

    if (!user) {
      loginScreen.classList.remove("hidden");
      appShell.classList.add("hidden");
      return;
    }

    try {
      const perfil = await getUsuarioPerfil(user.uid);
      const rol = perfil?.rol;

      setCurrentUserRole({ usuario: user, rol });

      const allowed = guardCurrentRoute({
        rol,
        onDenied: ({ message }) => showToast(message),
      });

      if (!allowed) {
        if (!hasRoutesForRole(rol)) await logout();
        return;
      }

      currentUser = user;
      loadCartFromStorage();
      renderNavbar(appNav, { rol });
      renderCart();
      loginScreen.classList.add("hidden");
      appShell.classList.remove("hidden");
    } catch (error) {
      console.error(error);
      showLoginError("No se pudo validar el rol del usuario.");
      await logout();
    }
  });
}

window.puntoVentaApp = () => ({
  init() {
    bootPuntoVentaApp();
  },
});

loadAlpine();
