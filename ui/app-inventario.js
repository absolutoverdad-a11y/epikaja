import {
  buscarProductoPorCodigo,
  guardarProducto,
  listenAuth,
  listenProductos,
  loginWithGoogle,
  logout,
  subirImagenProducto,
} from "../services/productos.js";
import { analizarPrendaConGemini } from "../services/gemini.js";
import { getUsuarioPerfil } from "../services/usuarios.js";
import {
  clearCurrentUserRole,
  guardCurrentRoute,
  hasRoutesForRole,
  renderNavbar,
  setCurrentUserRole,
} from "../src/ui/router.js";
import {
  DEFAULT_PRODUCT_IMAGE_URL,
  buildProductoPayload,
  calcularMargenGanancia,
  generarCodigoAleatorio,
  generarSku,
  normalizeCode,
  procesarImagenProducto,
} from "../logic/inventario-utils.js";
import { loadAlpine } from "./alpine-loader.js";
import { bindThemeToggle, initTheme } from "./theme.js";

let currentUser = null;
let currentProduct = null;
let productos = [];
let unsubscribeProductos = null;
let scanTimer = null;
let alpineBooted = false;
let selectedImageBlob = null;
let selectedAiImageBlob = null;
let selectedImagePreviewUrl = "";
let isSavingProduct = false;
let isAnalyzingImage = false;
let productosFiltrados = [];
let visibleLimit = 25;
let cameraStream = null;

const $ = (selector) => document.querySelector(selector);

const loginScreen = $("#loginScreen");
const appShell = $("#appShell");
const loginGoogle = $("#loginGoogle");
const logoutGoogle = $("#logoutGoogle");
const loginError = $("#loginError");
const toast = $("#toast");
const appNav = $("#appNav");

const formMode = $("#formMode");
const productoForm = $("#productoForm");
const nuevoProducto = $("#nuevoProducto");
const codigoBarras = $("#codigoBarras");
const generarCodigo = $("#generarCodigo");
const buscarCodigo = $("#buscarCodigo");
const scannerHint = $("#scannerHint");
const nombre = $("#nombre");
const marca = $("#marca");
const talla = $("#talla");
const costoCompra = $("#costoCompra");
const precioVenta = $("#precioVenta");
const ubicacion = $("#ubicacion");
const color = $("#color");
const descripcion = $("#descripcion");
const tipoPrenda = $("#tipoPrenda");
const stock = $("#stock");
const imagenProducto = $("#imagenProducto");
const imagenCamaraProducto = $("#imagenCamaraProducto");
const tomarFotoProducto = $("#tomarFotoProducto");
const subirFotoProducto = $("#subirFotoProducto");
const imagenEstado = $("#imagenEstado");
const imagenPreview = $("#imagenPreview");
const imagenPlaceholder = $("#imagenPlaceholder");
const imagenPeso = $("#imagenPeso");
const analizarPrendaIA = $("#analizarPrendaIA");
const analizarPrendaSpinner = $("#analizarPrendaSpinner");
const analizarPrendaTexto = $("#analizarPrendaTexto");
const margenGanancia = $("#margenGanancia");
const margenPorcentaje = $("#margenPorcentaje");
const productosLista = $("#productosLista");
const contadorProductos = $("#contadorProductos");
const buscarInventario = $("#buscarInventario");
const filtroTipo = $("#filtroTipo");
const filtroColor = $("#filtroColor");
const filtroTalla = $("#filtroTalla");
const filtroStock = $("#filtroStock");
const limiteProductos = $("#limiteProductos");
const limpiarFiltros = $("#limpiarFiltros");
const productosPaginacion = $("#productosPaginacion");
const mostrarMasProductos = $("#mostrarMasProductos");
const guardarProductoBtn = $("#guardarProductoBtn");
const guardarProductoTexto = $("#guardarProductoTexto");
const cameraModal = $("#cameraModal");
const cameraPreview = $("#cameraPreview");
const cerrarCamaraProducto = $("#cerrarCamaraProducto");
const cancelarCamaraProducto = $("#cancelarCamaraProducto");
const capturarFotoProducto = $("#capturarFotoProducto");

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

function showToast(message, variant = "success") {
  toast.textContent = message;
  toast.className = `fixed bottom-4 left-4 right-4 z-[60] rounded-lg px-4 py-3 text-sm font-semibold shadow-lg sm:left-auto sm:w-96 ${
    variant === "error" ? "bg-red-600 text-white" : "bg-green-600 text-white"
  }`;

  window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

function clearLoginError() {
  loginError.textContent = "";
  loginError.classList.add("hidden");
}

function setMode(mode) {
  formMode.textContent = mode === "edit" ? "Modo edicion" : "Modo registro";
  formMode.className = mode === "edit"
    ? "text-sm font-semibold text-yellow-600"
    : "text-sm font-semibold text-green-600";
}

function setSaveState(isBusy, text = "Guardar producto") {
  isSavingProduct = isBusy;
  guardarProductoBtn.disabled = isBusy;
  guardarProductoTexto.textContent = text;
}

function setAnalyzeState(isBusy, text = "Analizar Prenda con IA") {
  isAnalyzingImage = isBusy;
  analizarPrendaIA.disabled = isBusy || !selectedAiImageBlob;
  analizarPrendaTexto.textContent = text;
  analizarPrendaSpinner.classList.toggle("hidden", !isBusy);
}

function revokeSelectedPreview() {
  if (selectedImagePreviewUrl) {
    URL.revokeObjectURL(selectedImagePreviewUrl);
    selectedImagePreviewUrl = "";
  }
}

function setImagePreview(url, { sizeKb = null, estado = "" } = {}) {
  const src = url || DEFAULT_PRODUCT_IMAGE_URL;
  imagenPreview.src = src;
  imagenPreview.classList.remove("hidden");
  imagenPlaceholder.classList.add("hidden");
  imagenPeso.textContent = sizeKb ? `${sizeKb} KB WebP` : "";
  imagenEstado.textContent = estado || "Imagen lista.";
}

function resetImageState({ keepExistingUrl = "" } = {}) {
  revokeSelectedPreview();
  selectedImageBlob = null;
  selectedAiImageBlob = null;
  if (imagenProducto) imagenProducto.value = "";
  if (imagenCamaraProducto) imagenCamaraProducto.value = "";
  setAnalyzeState(false);

  if (keepExistingUrl) {
    setImagePreview(keepExistingUrl, { estado: "Foto actual del producto." });
    return;
  }

  imagenPreview.src = "";
  imagenPreview.classList.add("hidden");
  imagenPlaceholder.classList.remove("hidden");
  imagenPeso.textContent = "";
  imagenEstado.textContent = "Opcional. Se guardara como WebP ligero automaticamente.";
}

function stopProductCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  if (cameraPreview) cameraPreview.srcObject = null;
  cameraModal?.classList.add("hidden");
}

async function openProductCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    imagenCamaraProducto.click();
    return;
  }

  try {
    stopProductCamera();
    cameraModal.classList.remove("hidden");
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    cameraPreview.srcObject = cameraStream;
    await cameraPreview.play();
  } catch (error) {
    console.error(error);
    stopProductCamera();
    showToast("No se pudo abrir la camara. Revisa permisos o usa Subir imagen.", "error");
    imagenCamaraProducto.click();
  }
}

function canvasToJpegFile(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo capturar la foto."));
          return;
        }

        resolve(new File([blob], `foto-producto-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  });
}

async function handleSelectedImage(file) {
  if (!file) {
    resetImageState({ keepExistingUrl: currentProduct?.imagenUrl || "" });
    return;
  }

  setSaveState(true, "Procesando...");
  setAnalyzeState(true, "Procesando imagen...");
  imagenEstado.textContent = "Procesando imagen en este dispositivo...";

  try {
    const processed = await procesarImagenProducto(file, {
      maxWidth: 600,
      quality: 0.75,
    });
    const aiProcessed = await procesarImagenProducto(file, {
      maxWidth: 1024,
      quality: 0.75,
    });

    revokeSelectedPreview();
    selectedImageBlob = processed.blob;
    selectedAiImageBlob = aiProcessed.blob;
    selectedImagePreviewUrl = processed.previewUrl;
    setImagePreview(processed.previewUrl, {
      sizeKb: processed.sizeKb,
      estado: "Lista para subir como WebP.",
    });
    setAnalyzeState(false);
  } catch (error) {
    console.error(error);
    resetImageState({ keepExistingUrl: currentProduct?.imagenUrl || "" });
    showToast(error.message || "No se pudo procesar la imagen.", "error");
  } finally {
    setSaveState(false);
  }
}

async function captureProductPhoto() {
  if (!cameraPreview?.videoWidth || !cameraPreview?.videoHeight) {
    showToast("La camara aun no esta lista. Intenta de nuevo.", "error");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = cameraPreview.videoWidth;
  canvas.height = cameraPreview.videoHeight;
  canvas.getContext("2d").drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);

  try {
    const file = await canvasToJpegFile(canvas);
    stopProductCamera();
    await handleSelectedImage(file);
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo capturar la foto.", "error");
  }
}

function updateMargin() {
  const margin = calcularMargenGanancia(precioVenta.value, costoCompra.value);
  margenGanancia.textContent = moneyFormatter.format(margin.ganancia);
  margenGanancia.classList.toggle("text-red-600", margin.ganancia < 0);
  margenGanancia.classList.toggle("text-green-600", margin.ganancia >= 0);
  margenPorcentaje.textContent = `${margin.porcentaje}% sobre costo`;
}

function resetForm() {
  currentProduct = null;
  productoForm.reset();
  stock.value = "1";
  ubicacion.value = "tienda";
  setMode("create");
  updateMargin();
  resetImageState();
  codigoBarras.disabled = false;
  codigoBarras.focus();
}

function fillForm(producto) {
  currentProduct = producto;
  setMode("edit");
  codigoBarras.value = producto.codigoBarras ?? producto.id ?? "";
  nombre.value = producto.nombre ?? "";
  talla.value = producto.talla ?? "";
  costoCompra.value = producto.costoCompra ?? 0;
  precioVenta.value = producto.precioVenta ?? 0;
  ubicacion.value = producto.ubicacion || "tienda";
  color.value = producto.color ?? "";
  tipoPrenda.value = producto.tipoPrenda ?? "";
  marca.value = producto.marca ?? "";
  descripcion.value = producto.descripcion ?? "";
  stock.value = producto.stock ?? 0;
  resetImageState({ keepExistingUrl: producto.imagenUrl || DEFAULT_PRODUCT_IMAGE_URL });
  updateMargin();
}

async function findByCode({ silentNew = false } = {}) {
  const code = normalizeCode(codigoBarras.value);

  if (!code) {
    showToast("Escanea, escribe o genera un codigo.", "error");
    return null;
  }

  codigoBarras.value = code;

  try {
    const producto = await buscarProductoPorCodigo(code);

    if (producto) {
      fillForm(producto);
      showToast("Producto encontrado. Modo edicion activo.");
      return producto;
    }

    currentProduct = null;
    setMode("create");
    if (!silentNew) showToast("Codigo nuevo. Completa los datos para registrarlo.");
    return null;
  } catch (error) {
    console.error(error);
    showToast("No se pudo buscar el producto.", "error");
    return null;
  }
}

async function generateUniqueCode() {
  const baseData = {
    tipoPrenda: tipoPrenda.value || "PRENDA",
    color: color.value || "V",
    talla: talla.value || "UNI",
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = attempt < 5 ? generarSku(baseData) : generarCodigoAleatorio();
    const existing = await buscarProductoPorCodigo(code);
    if (!existing) return code;
  }

  return generarCodigoAleatorio();
}

function scheduleScannerLookup() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    if (codigoBarras.value.trim().length >= 4) {
      findByCode({ silentNew: true });
    }
  }, 450);
}

function normalizeFilterValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueSortedValues(field) {
  return [...new Set(productos.map((producto) => String(producto[field] ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function renderFilterOptions(select, values, emptyLabel) {
  const selectedValue = select.value;
  select.innerHTML = `<option value="">${emptyLabel}</option>${values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("")}`;

  if (values.includes(selectedValue)) {
    select.value = selectedValue;
  }
}

function renderDynamicFilters() {
  renderFilterOptions(filtroTipo, uniqueSortedValues("tipoPrenda"), "Todos");
  renderFilterOptions(filtroColor, uniqueSortedValues("color"), "Todos");
  renderFilterOptions(filtroTalla, uniqueSortedValues("talla"), "Todas");
}

function productMatchesSearch(producto, term) {
  if (!term) return true;

  return [
    producto.codigoBarras,
    producto.id,
    producto.nombre,
    producto.marca,
    producto.tipoPrenda,
    producto.color,
    producto.talla,
    producto.ubicacion,
    producto.descripcion,
  ]
    .map(normalizeFilterValue)
    .some((value) => value.includes(term));
}

function productMatchesStock(producto, stockFilter) {
  const productStock = Number(producto.stock || 0);
  if (!stockFilter) return true;
  if (stockFilter === "agotado") return productStock <= 0;
  if (stockFilter === "bajo") return productStock > 0 && productStock <= 3;
  if (stockFilter === "disponible") return productStock > 0;
  return true;
}

function getFilteredProducts() {
  const searchTerm = normalizeFilterValue(buscarInventario.value);
  const typeFilter = normalizeFilterValue(filtroTipo.value);
  const colorFilter = normalizeFilterValue(filtroColor.value);
  const sizeFilter = normalizeFilterValue(filtroTalla.value);
  const stockFilter = filtroStock.value;

  return productos.filter((producto) => {
    const matchesType = !typeFilter || normalizeFilterValue(producto.tipoPrenda) === typeFilter;
    const matchesColor = !colorFilter || normalizeFilterValue(producto.color) === colorFilter;
    const matchesSize = !sizeFilter || normalizeFilterValue(producto.talla) === sizeFilter;

    return (
      productMatchesSearch(producto, searchTerm)
      && matchesType
      && matchesColor
      && matchesSize
      && productMatchesStock(producto, stockFilter)
    );
  });
}

function renderProductos() {
  productosFiltrados = getFilteredProducts();
  const productosVisibles = productosFiltrados.slice(0, visibleLimit);
  const hasFilters = Boolean(
    buscarInventario.value
    || filtroTipo.value
    || filtroColor.value
    || filtroTalla.value
    || filtroStock.value
  );

  contadorProductos.textContent = hasFilters
    ? `${productosFiltrados.length} de ${productos.length} productos`
    : `${productos.length} productos`;

  if (productos.length === 0) {
    productosLista.innerHTML = '<div class="px-5 py-8 text-center text-sm text-gray-500">Aun no hay productos registrados.</div>';
    productosPaginacion.classList.add("hidden");
    return;
  }

  if (productosFiltrados.length === 0) {
    productosLista.innerHTML = '<div class="px-5 py-8 text-center text-sm text-gray-500">No hay productos que coincidan con los filtros.</div>';
    productosPaginacion.classList.add("hidden");
    return;
  }

  productosLista.innerHTML = productosVisibles
    .map((producto) => {
      const margin = calcularMargenGanancia(producto.precioVenta, producto.costoCompra);
      const stockValue = Number(producto.stock || 0);
      const stockClass = stockValue <= 0
        ? "text-red-600"
        : stockValue <= 3
          ? "text-yellow-600"
          : "text-gray-500";

      return `
        <article class="grid grid-cols-[72px_1fr] gap-3 px-5 py-4 lg:grid-cols-[72px_1fr_auto] lg:items-center">
          <img src="${escapeHtml(producto.imagenUrl || DEFAULT_PRODUCT_IMAGE_URL)}" alt="${escapeHtml(producto.nombre || "Producto")}" onerror="this.onerror=null;this.src='${DEFAULT_PRODUCT_IMAGE_URL}'" class="h-[72px] w-[72px] rounded-lg bg-gray-100 object-cover">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-gray-950">${escapeHtml(producto.nombre)}</p>
              <span class="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">${escapeHtml(producto.codigoBarras ?? producto.id)}</span>
            </div>
            <p class="mt-1 text-sm text-gray-600">
              ${escapeHtml(producto.tipoPrenda || "Sin tipo")} - ${escapeHtml(producto.marca || "Sin marca")} - ${escapeHtml(producto.color || "Sin color")} - Talla ${escapeHtml(producto.talla || "N/A")}
            </p>
            <p class="mt-1 text-xs text-gray-500">
              <span class="${stockClass}">Stock: ${stockValue}</span> | Costo: ${moneyFormatter.format(producto.costoCompra || 0)} | Venta: ${moneyFormatter.format(producto.precioVenta || 0)} | Ganancia: ${moneyFormatter.format(margin.ganancia)}
            </p>
            <p class="mt-1 text-xs text-gray-400">${escapeHtml(producto.ubicacion || "Sin ubicacion")}</p>
          </div>
          <button type="button" data-edit-product="${escapeHtml(producto.codigoBarras ?? producto.id)}" class="rounded-lg bg-gray-950 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800">
            Editar
          </button>
        </article>
      `;
    })
    .join("");

  productosPaginacion.classList.toggle("hidden", visibleLimit >= productosFiltrados.length);
  mostrarMasProductos.textContent = `Mostrar mas (${productosFiltrados.length - productosVisibles.length})`;
}

function startProductListener() {
  unsubscribeProductos?.();
  unsubscribeProductos = listenProductos(
    (items) => {
      productos = items;
      renderDynamicFilters();
      renderProductos();
      renderNavbar(appNav);
      loginScreen.classList.add("hidden");
      appShell.classList.remove("hidden");
      clearLoginError();
    },
    async (error) => {
      console.error(error);
      if (error?.code === "permission-denied") {
        loginScreen.classList.remove("hidden");
        appShell.classList.add("hidden");
        showLoginError("Tu usuario no tiene permiso para ver inventario.");
        await logout();
      } else {
        showToast("No se pudo cargar el inventario.", "error");
      }
    }
  );
}

function bootInventarioApp() {
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
  await logout();
});

nuevoProducto.addEventListener("click", resetForm);

codigoBarras.addEventListener("focus", () => {
  scannerHint.textContent = "Listo para escanear. Dispara el escaner o presiona Enter al terminar.";
});

codigoBarras.addEventListener("input", scheduleScannerLookup);

codigoBarras.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    findByCode();
  }
});

buscarCodigo.addEventListener("click", () => findByCode());

generarCodigo.addEventListener("click", async () => {
  try {
    codigoBarras.value = await generateUniqueCode();
    currentProduct = null;
    setMode("create");
    showToast("Codigo unico generado. Completa o revisa los datos.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo generar un codigo unico.", "error");
  }
});

[costoCompra, precioVenta].forEach((input) => {
  input.addEventListener("input", updateMargin);
});

[buscarInventario, filtroTipo, filtroColor, filtroTalla, filtroStock].forEach((control) => {
  control.addEventListener("input", () => {
    visibleLimit = Number(limiteProductos.value || 25);
    renderProductos();
  });
  control.addEventListener("change", () => {
    visibleLimit = Number(limiteProductos.value || 25);
    renderProductos();
  });
});

limiteProductos.addEventListener("change", () => {
  visibleLimit = Number(limiteProductos.value || 25);
  renderProductos();
});

mostrarMasProductos.addEventListener("click", () => {
  visibleLimit += Number(limiteProductos.value || 25);
  renderProductos();
});

limpiarFiltros.addEventListener("click", () => {
  buscarInventario.value = "";
  filtroTipo.value = "";
  filtroColor.value = "";
  filtroTalla.value = "";
  filtroStock.value = "";
  visibleLimit = Number(limiteProductos.value || 25);
  renderProductos();
});

tomarFotoProducto.addEventListener("click", () => {
  openProductCamera();
});

subirFotoProducto.addEventListener("click", () => {
  imagenProducto.click();
});

imagenProducto.addEventListener("change", async (event) => {
  await handleSelectedImage(event.target.files?.[0]);
});

imagenCamaraProducto.addEventListener("change", async (event) => {
  await handleSelectedImage(event.target.files?.[0]);
});

cerrarCamaraProducto.addEventListener("click", stopProductCamera);
cancelarCamaraProducto.addEventListener("click", stopProductCamera);
capturarFotoProducto.addEventListener("click", captureProductPhoto);

analizarPrendaIA.addEventListener("click", async () => {
  if (isAnalyzingImage || !selectedAiImageBlob) return;

  setAnalyzeState(true, "Gemini esta analizando tu prenda...");

  try {
    const result = await analizarPrendaConGemini(selectedAiImageBlob);

    if (result.nombre_sugerido) nombre.value = result.nombre_sugerido;
    if (result.tipo) tipoPrenda.value = result.tipo;
    if (result.marca) marca.value = result.marca;
    if (result.color) color.value = result.color;
    if (result.descripcion) descripcion.value = result.descripcion;
    if (Number(result.costo_estimado) > 0) {
      costoCompra.value = Number(result.costo_estimado);
    }
    if (!stock.value) stock.value = "1";
    if (!ubicacion.value.trim()) ubicacion.value = "tienda";

    updateMargin();
    showToast("Datos extraidos con exito. Por favor revisa y ajusta los campos antes de guardar.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo analizar la imagen. Intenta con otra foto o llena los campos manualmente.", "error");
  } finally {
    setAnalyzeState(false);
  }
});

productosLista.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-product]");
  if (!button) return;

  codigoBarras.value = button.dataset.editProduct;
  await findByCode();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

productoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSavingProduct) return;

  const result = buildProductoPayload({
    codigoBarras: codigoBarras.value,
    nombre: nombre.value,
    talla: talla.value,
    costoCompra: costoCompra.value,
    precioVenta: precioVenta.value,
    ubicacion: ubicacion.value,
    color: color.value,
    marca: marca.value,
    descripcion: descripcion.value,
    tipoPrenda: tipoPrenda.value,
    stock: stock.value,
    existente: currentProduct,
  });

  if (result.error) {
    showToast(result.error, "error");
    return;
  }

  let imageData = {
    imagenUrl: currentProduct?.imagenUrl || DEFAULT_PRODUCT_IMAGE_URL,
    imagenPath: currentProduct?.imagenPath || "",
  };

  try {
    setSaveState(true, selectedImageBlob ? "Subiendo..." : "Guardando...");

    if (selectedImageBlob) {
      try {
        imageData = await subirImagenProducto(result.producto.codigoBarras, selectedImageBlob);
      } catch (uploadError) {
        console.error(uploadError);
        showToast("Error al subir la imagen. Por favor, verifica tu conexion e intentalo de nuevo", "error");
        return;
      }
    }

    await guardarProducto(
      {
        ...result.producto,
        imagenUrl: imageData.imagenUrl,
        imagenPath: imageData.imagenPath,
      },
      currentUser
    );
    showToast(currentProduct ? "Producto actualizado correctamente." : "Producto registrado correctamente.");
    resetForm();
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar el producto.", "error");
  } finally {
    setSaveState(false);
  }
});

listenAuth(async (user) => {
  currentUser = null;
  unsubscribeProductos?.();
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
      onDenied: ({ message }) => {
        showToast(message, "error");
        loginScreen.classList.add("hidden");
        appShell.classList.add("hidden");
      },
    });

    if (!allowed) {
      if (!hasRoutesForRole(rol)) await logout();
      return;
    }

    currentUser = user;
    renderNavbar(appNav, { rol });
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
    resetForm();
    startProductListener();
  } catch (error) {
    console.error(error);
    showLoginError("No se pudo validar el rol del usuario.");
    await logout();
  }
});
}

window.inventarioApp = () => ({
  init() {
    bootInventarioApp();
  },
});

loadAlpine();
