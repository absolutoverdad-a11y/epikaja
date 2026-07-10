import {
  getTransaccionesByFecha,
  listenAuth,
  listenSaldos,
  listenTransacciones,
  loginWithGoogle,
  logout,
  saveSaldos,
  saveTransaction,
} from "../services/transacciones.js";
import { getUsuarioPerfil } from "../services/usuarios.js";
import {
  clearCurrentUserRole,
  guardCurrentRoute,
  hasRoutesForRole,
  renderNavbar,
  setCurrentUserRole,
} from "../src/ui/router.js";
import {
  calculateBalances,
  createExcelReport,
  cuentaLabels,
  getTransactionDate,
  getTransactionCuenta,
  moneyFormatter,
  outputSign,
  parseAmount,
  summarizeCorte,
  summarizeMovimientos,
  summarizePrendas,
  typeLabels,
  validateAccountBalance,
} from "../logic/financiero.js";
import { loadAlpine } from "./alpine-loader.js";
import { bindThemeToggle, initTheme } from "./theme.js";

let allTransactions = [];
let saldosIniciales = { caja: 0, ahorro: 0 };
let saldosActuales = { caja: 0, ahorro: 0, total: 0 };
let currentUser = null;
let unsubscribeTransactions = null;
let unsubscribeSaldos = null;
let alpineBooted = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const loginScreen = $("#loginScreen");
const appShell = $("#appShell");
const loginGoogle = $("#loginGoogle");
const logoutGoogle = $("#logoutGoogle");
const loginError = $("#loginError");
const appNav = $("#appNav");

const saldoActual = $("#saldoActual");
const saldoCaja = $("#saldoCaja");
const saldoAhorro = $("#saldoAhorro");
const resumenMovimientos = $("#resumenMovimientos");
const historial = $("#historial");
const connectionStatus = $("#connectionStatus");
const toast = $("#toast");

const formSaldos = $("#formSaldos");
const saldoInicialCaja = $("#saldoInicialCaja");
const saldoInicialAhorro = $("#saldoInicialAhorro");

const formCorte = $("#formCorte");
const cuentaCorte = $("#cuentaCorte");
const fechaOperacionCorte = $("#fechaOperacionCorte");
const montoCorte = $("#montoCorte");
const ceroVentas = $("#ceroVentas");
const conceptoExtraCorte = $("#conceptoExtraCorte");
const montoExtraCorte = $("#montoExtraCorte");
const listaPrendas = $("#listaPrendas");
const agregarPrenda = $("#agregarPrenda");

const formGasto = $("#formGasto");
const fechaOperacionGasto = $("#fechaOperacionGasto");
const cuentaGasto = $("#cuentaGasto");
const conceptoGasto = $("#conceptoGasto");
const montoGasto = $("#montoGasto");

const formRetiro = $("#formRetiro");
const fechaOperacionRetiro = $("#fechaOperacionRetiro");
const cuentaRetiro = $("#cuentaRetiro");
const tipoRetiro = $("#tipoRetiro");
const notaRetiroWrapper = $("#notaRetiroWrapper");
const notaRetiro = $("#notaRetiro");
const montoRetiro = $("#montoRetiro");

const fechaInicioReporte = $("#fechaInicioReporte");
const fechaFinReporte = $("#fechaFinReporte");
const descargarReporte = $("#descargarReporte");

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

function showRouteDenied(message) {
  showToast(message, "error");
  loginScreen.classList.add("hidden");
  appShell.classList.add("hidden");
}

function clearLoginError() {
  loginError.textContent = "";
  loginError.classList.add("hidden");
}

function setConnectionState(state) {
  const styles = {
    connected: "bg-green-100 text-green-800",
    loading: "bg-yellow-100 text-yellow-800",
    error: "bg-red-100 text-red-800",
  };

  const labels = {
    connected: "En linea",
    loading: "Conectando",
    error: "Error",
  };

  connectionStatus.className = `rounded-full px-3 py-1 text-xs font-semibold ${styles[state]}`;
  connectionStatus.textContent = labels[state];
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeModal(modal) {
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function closeActiveModals() {
  $$(".fixed[role='dialog']").forEach(closeModal);
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Guardando fecha...";

  return timestamp.toDate().toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function resetOperacionDates() {
  const today = getTodayInputValue();
  fechaOperacionCorte.value = today;
  fechaOperacionGasto.value = today;
  fechaOperacionRetiro.value = today;
}

function isValidOperacionDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function formatOperacionDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function renderBalances() {
  saldosActuales = calculateBalances(allTransactions, saldosIniciales);
  saldoActual.textContent = moneyFormatter.format(saldosActuales.total);
  saldoCaja.textContent = moneyFormatter.format(saldosActuales.caja);
  saldoAhorro.textContent = moneyFormatter.format(saldosActuales.ahorro);

  saldoActual.classList.toggle("text-red-600", saldosActuales.total < 0);
  saldoActual.classList.toggle("text-green-600", saldosActuales.total >= 0);
  saldoCaja.classList.toggle("text-red-600", saldosActuales.caja < 0);
  saldoCaja.classList.toggle("text-gray-950", saldosActuales.caja >= 0);
  saldoAhorro.classList.toggle("text-red-600", saldosActuales.ahorro < 0);
  saldoAhorro.classList.toggle("text-gray-950", saldosActuales.ahorro >= 0);

  saldoInicialCaja.value = saldosIniciales.caja || 0;
  saldoInicialAhorro.value = saldosIniciales.ahorro || 0;
}

function createPrendaRow() {
  const row = document.createElement("div");
  row.className = "grid grid-cols-1 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[1fr_90px_120px_44px]";
  row.innerHTML = `
    <label class="block">
      <span class="text-xs font-semibold text-gray-600">Prenda</span>
      <input data-prenda-nombre type="text" maxlength="80" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" placeholder="Ej. Blusa, pantalon" />
    </label>
    <label class="block">
      <span class="text-xs font-semibold text-gray-600">Cant.</span>
      <input data-prenda-cantidad type="number" min="1" step="1" inputmode="numeric" value="1" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" />
    </label>
    <label class="block">
      <span class="text-xs font-semibold text-gray-600">Precio</span>
      <input data-prenda-precio type="number" min="0.01" step="0.01" inputmode="decimal" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" placeholder="0.00" />
    </label>
    <button data-remover-prenda type="button" class="mt-5 rounded-lg bg-white px-3 py-2 text-sm font-bold text-red-600 shadow-sm hover:bg-red-50" aria-label="Quitar prenda">X</button>
  `;

  row.addEventListener("input", updateCorteTotal);
  row.querySelector("[data-remover-prenda]").addEventListener("click", () => {
    row.remove();
    updateCorteTotal();
  });

  listaPrendas.appendChild(row);
  row.querySelector("[data-prenda-nombre]").focus();
}

function getPrendasFromForm() {
  return [...listaPrendas.children]
    .map((row) => {
      const nombre = row.querySelector("[data-prenda-nombre]").value.trim();
      const cantidad = Number(row.querySelector("[data-prenda-cantidad]").value);
      const precioUnitario = parseAmount(row.querySelector("[data-prenda-precio]").value);

      if (!nombre && !precioUnitario) return null;
      if (!nombre || !Number.isInteger(cantidad) || cantidad <= 0 || !precioUnitario || precioUnitario <= 0) return false;

      return {
        nombre,
        cantidad,
        precioUnitario,
        subtotal: Math.round(cantidad * precioUnitario * 100) / 100,
      };
    })
    .filter((item) => item !== null);
}

function updateCorteTotal() {
  const prendas = getPrendasFromForm();
  const hasInvalid = prendas.includes(false);
  const validPrendas = prendas.filter(Boolean);
  const extra = parseAmount(montoExtraCorte.value) ?? 0;
  const total = validPrendas.reduce((sum, item) => sum + item.subtotal, 0) + extra;

  montoCorte.value = hasInvalid ? "" : total.toFixed(2);
}

function resetCorteForm() {
  formCorte.reset();
  fechaOperacionCorte.value = getTodayInputValue();
  cuentaCorte.value = "caja";
  montoCorte.value = "";
  montoCorte.disabled = false;
  listaPrendas.innerHTML = "";
  agregarPrenda.disabled = false;
  createPrendaRow();
}

function renderTransactions(transacciones) {
  const summary = summarizeMovimientos(transacciones);

  renderBalances();
  resumenMovimientos.textContent = `${summary.ingresos} ingresos - ${summary.salidas} salidas`;

  if (transacciones.length === 0) {
    historial.innerHTML = '<div class="px-5 py-8 text-center text-sm text-gray-500">Aun no hay movimientos registrados.</div>';
    return;
  }

  historial.innerHTML = transacciones
    .slice()
    .sort((a, b) => (getTransactionDate(b)?.getTime() ?? 0) - (getTransactionDate(a)?.getTime() ?? 0))
    .map((item) => {
      const sign = outputSign[item.tipo] ?? -1;
      const isIncome = sign > 0;
      const amountClass = isIncome ? "text-green-600" : "text-red-600";
      const signedAmount = `${isIncome ? "+" : "-"} ${moneyFormatter.format(item.monto)}`;
      const detail = item.tipo === "ingreso_corte" ? summarizeCorte(item) : item.concepto;
      const cuenta = cuentaLabels[getTransactionCuenta(item)];

      return `
        <article class="flex items-start justify-between gap-4 px-5 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-gray-950">${escapeHtml(typeLabels[item.tipo] ?? "Movimiento")}</p>
              <span class="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">${escapeHtml(cuenta)}</span>
            </div>
            <p class="mt-1 truncate text-sm text-gray-600">${escapeHtml(detail)}</p>
            <p class="mt-1 text-xs text-gray-400">
              ${escapeHtml(item.fechaOperacion ? `Operacion: ${formatOperacionDate(item.fechaOperacion)} | Guardado: ${formatDate(item.fecha)}` : formatDate(item.fecha))}
            </p>
          </div>
          <p class="shrink-0 text-right font-bold ${amountClass}">${signedAmount}</p>
        </article>
      `;
    })
    .join("");
}

function parseDateRange() {
  if (!fechaInicioReporte.value || !fechaFinReporte.value) {
    showToast("Selecciona fecha de inicio y fecha final.", "error");
    return null;
  }

  const start = new Date(`${fechaInicioReporte.value}T00:00:00`);
  const end = new Date(`${fechaFinReporte.value}T23:59:59.999`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    showToast("El periodo de fechas no es valido.", "error");
    return null;
  }

  return { start, end };
}

async function downloadExcelReport() {
  if (!window.XLSX) {
    showToast("No se pudo cargar la libreria de Excel. Revisa tu conexion.", "error");
    return;
  }

  const range = parseDateRange();
  if (!range) return;

  let transactions = [];
  try {
    transactions = await getTransaccionesByFecha(range);
  } catch (error) {
    console.error(error);
    showToast("No se pudo consultar el periodo en Firestore.", "error");
    return;
  }

  if (transactions.length === 0) {
    showToast("No hay movimientos en el periodo seleccionado.", "error");
    return;
  }

  const workbook = createExcelReport({
    XLSX: window.XLSX,
    transactions,
    start: range.start,
    end: range.end,
    saldosActuales,
    fechaInicio: fechaInicioReporte.value,
    fechaFin: fechaFinReporte.value,
  });

  window.XLSX.writeFile(workbook, `reporte-epika-${fechaInicioReporte.value}-a-${fechaFinReporte.value}.xlsx`);
}

function startDataListeners() {
  unsubscribeTransactions?.();
  unsubscribeSaldos?.();
  setConnectionState("loading");

  unsubscribeSaldos = listenSaldos(
    (saldos) => {
      saldosIniciales = saldos;
      renderBalances();
    },
    (error) => {
      console.error(error);
      handleDataPermissionError(error);
      setConnectionState("error");
    }
  );

  unsubscribeTransactions = listenTransacciones(
    (transactions) => {
      allTransactions = transactions;
      renderTransactions(allTransactions);
      clearLoginError();
      loginScreen.classList.add("hidden");
      appShell.classList.remove("hidden");
      setConnectionState("connected");
    },
    (error) => {
      console.error(error);
      handleDataPermissionError(error);
      historial.innerHTML = '<div class="px-5 py-8 text-center text-sm text-red-600">No se pudo cargar el historial. Revisa la configuracion, Authentication y reglas de Firestore.</div>';
      setConnectionState("error");
    }
  );
}

async function handleDataPermissionError(error) {
  if (error?.code !== "permission-denied") return;

  stopDataListeners();
  currentUser = null;
  appShell.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  showLoginError("Tu correo no tiene permiso para usar esta app. Inicia sesion con un correo autorizado.");

  try {
    await logout();
  } catch (signOutError) {
    console.error(signOutError);
  }
}

function stopDataListeners() {
  unsubscribeTransactions?.();
  unsubscribeSaldos?.();
  unsubscribeTransactions = null;
  unsubscribeSaldos = null;
}

function bootFinancieroApp() {
  if (alpineBooted) return;
  alpineBooted = true;

$$("[data-open-modal]").forEach((button) => {
  button.addEventListener("click", () => openModal(button.dataset.openModal));
});

$$("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.closest("[role='dialog']")));
});

$$("[role='dialog']").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal(modal);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeActiveModals();
});

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

formSaldos.addEventListener("submit", async (event) => {
  event.preventDefault();
  const caja = parseAmount(saldoInicialCaja.value);
  const ahorro = parseAmount(saldoInicialAhorro.value);

  if (caja === null || ahorro === null) {
    showToast("Ingresa saldos validos.", "error");
    return;
  }

  try {
    await saveSaldos({ caja, ahorro, user: currentUser });
    closeActiveModals();
    showToast("Saldos guardados correctamente.");
  } catch (error) {
    console.error(error);
    showToast("No se pudieron guardar los saldos.", "error");
  }
});

agregarPrenda.addEventListener("click", createPrendaRow);
montoExtraCorte.addEventListener("input", updateCorteTotal);

ceroVentas.addEventListener("change", () => {
  if (ceroVentas.checked) {
    listaPrendas.innerHTML = "";
    updateCorteTotal();
    montoCorte.disabled = true;
    agregarPrenda.disabled = true;
  } else {
    montoCorte.disabled = false;
    montoCorte.value = "";
    agregarPrenda.disabled = false;
    createPrendaRow();
  }
});

tipoRetiro.addEventListener("change", () => {
  const isExternal = tipoRetiro.value === "gasto_externo";
  notaRetiroWrapper.classList.toggle("hidden", !isExternal);
  notaRetiro.required = isExternal;
  if (!isExternal) notaRetiro.value = "";
});

formCorte.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prendas = ceroVentas.checked ? [] : getPrendasFromForm();
  const extraAmount = parseAmount(montoExtraCorte.value) ?? 0;
  const extraConcept = conceptoExtraCorte.value.trim();
  const fechaOperacion = fechaOperacionCorte.value;

  if (prendas.includes(false)) {
    showToast("Completa nombre, cantidad y precio de cada prenda.", "error");
    return;
  }

  if (!isValidOperacionDate(fechaOperacion)) {
    showToast("Selecciona una fecha valida para el corte.", "error");
    return;
  }

  if (extraAmount > 0 && !extraConcept) {
    showToast("Agrega un concepto para el dinero extra.", "error");
    return;
  }

  if (!ceroVentas.checked && prendas.length === 0 && extraAmount <= 0) {
    showToast("Agrega al menos una prenda, dinero extra o marca cero ventas.", "error");
    return;
  }

  const ventasAmount = ceroVentas.checked ? 0 : prendas.reduce((sum, item) => sum + item.subtotal, 0);
  const amount = ventasAmount + extraAmount;
  const parts = [];
  if (ceroVentas.checked) parts.push("cero ventas");
  if (prendas.length > 0) parts.push(`${prendas.length} prendas capturadas`);
  if (extraAmount > 0) parts.push(`extra: ${extraConcept}`);

  try {
    await saveTransaction({
      tipo: "ingreso_corte",
      monto: Math.round(amount * 100) / 100,
      concepto: `Corte del dia: ${parts.join(", ") || "sin movimientos"}`,
      cuenta: cuentaCorte.value,
      prendas,
      ingresoExtra: extraAmount > 0 ? { concepto: extraConcept, monto: extraAmount } : null,
      fechaOperacion,
      user: currentUser,
    });
    resetCorteForm();
    closeActiveModals();
    showToast("Corte guardado correctamente.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar el corte. Revisa Firebase.", "error");
  }
});

formGasto.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(montoGasto.value);
  const cuenta = cuentaGasto.value;
  const fechaOperacion = fechaOperacionGasto.value;

  if (!amount || amount <= 0) {
    showToast("Ingresa un monto de gasto valido.", "error");
    return;
  }

  if (!isValidOperacionDate(fechaOperacion)) {
    showToast("Selecciona una fecha valida para el gasto.", "error");
    return;
  }

  const validation = validateAccountBalance(cuenta, amount, saldosActuales);
  if (!validation.valid) {
    showToast(validation.message, "error");
    return;
  }

  try {
    await saveTransaction({
      tipo: "gasto_operativo",
      monto: amount,
      concepto: conceptoGasto.value,
      cuenta,
      fechaOperacion,
      user: currentUser,
    });
    formGasto.reset();
    fechaOperacionGasto.value = getTodayInputValue();
    cuentaGasto.value = "caja";
    closeActiveModals();
    showToast("Gasto guardado correctamente.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar el gasto. Revisa Firebase.", "error");
  }
});

formRetiro.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(montoRetiro.value);
  const cuenta = cuentaRetiro.value;
  const fechaOperacion = fechaOperacionRetiro.value;
  const isExternal = tipoRetiro.value === "gasto_externo";
  const note = notaRetiro.value.trim();

  if (!amount || amount <= 0) {
    showToast("Ingresa un monto de retiro valido.", "error");
    return;
  }

  if (!isValidOperacionDate(fechaOperacion)) {
    showToast("Selecciona una fecha valida para el retiro.", "error");
    return;
  }

  if (isExternal && !note) {
    showToast("Agrega una nota para el gasto externo.", "error");
    return;
  }

  const validation = validateAccountBalance(cuenta, amount, saldosActuales);
  if (!validation.valid) {
    showToast(validation.message, "error");
    return;
  }

  try {
    await saveTransaction({
      tipo: tipoRetiro.value,
      monto: amount,
      concepto: isExternal ? note : "Pago de sueldo",
      cuenta,
      fechaOperacion,
      user: currentUser,
    });
    formRetiro.reset();
    fechaOperacionRetiro.value = getTodayInputValue();
    cuentaRetiro.value = "caja";
    notaRetiroWrapper.classList.add("hidden");
    notaRetiro.required = false;
    closeActiveModals();
    showToast("Retiro guardado correctamente.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar el retiro. Revisa Firebase.", "error");
  }
});

descargarReporte.addEventListener("click", downloadExcelReport);

initTheme();
bindThemeToggle();
resetOperacionDates();

listenAuth(async (user) => {
  stopDataListeners();
  currentUser = null;
  allTransactions = [];
  clearCurrentUserRole();

  if (!user) {
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
    setConnectionState("loading");
    return;
  }

  try {
    const perfil = await getUsuarioPerfil(user.uid);
    const rol = perfil?.rol;

    setCurrentUserRole({ usuario: user, rol });

    const allowed = guardCurrentRoute({
      rol,
      onDenied: ({ message }) => showRouteDenied(message),
    });

    if (!allowed) {
      if (!hasRoutesForRole(rol)) await logout();
      return;
    }

    currentUser = user;
    renderNavbar(appNav, { rol });
    clearLoginError();
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
  resetCorteForm();
  startDataListeners();
  } catch (error) {
    console.error(error);
    showLoginError("No se pudo validar el rol del usuario.");
    await logout();
  }
});
}

window.financieroApp = () => ({
  init() {
    bootFinancieroApp();
  },
});

loadAlpine();
