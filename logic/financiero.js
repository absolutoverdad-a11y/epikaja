export const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export const typeLabels = {
  ingreso_corte: "Corte del dia",
  gasto_operativo: "Gasto operativo",
  retiro_sueldo: "Pago de sueldo",
  gasto_externo: "Gasto externo",
};

export const cuentaLabels = {
  caja: "Caja",
  ahorro: "Ahorro",
};

export const outputSign = {
  ingreso_corte: 1,
  gasto_operativo: -1,
  retiro_sueldo: -1,
  gasto_externo: -1,
};

export function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100) / 100;
}

export function getTransactionDate(item) {
  if (typeof item.fechaOperacion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.fechaOperacion)) {
    return new Date(`${item.fechaOperacion}T12:00:00`);
  }

  if (item.fecha?.toDate) return item.fecha.toDate();
  if (item.fecha instanceof Date) return item.fecha;
  return null;
}

export function getSavedDate(item) {
  if (item.fecha?.toDate) return item.fecha.toDate();
  if (item.fecha instanceof Date) return item.fecha;
  return null;
}

export function getTransactionCuenta(item) {
  return item.cuenta === "ahorro" ? "ahorro" : "caja";
}

export function calculateBalances(transacciones = [], saldosIniciales = { caja: 0, ahorro: 0 }) {
  const balances = {
    caja: Number(saldosIniciales.caja || 0),
    ahorro: Number(saldosIniciales.ahorro || 0),
  };

  transacciones.forEach((item) => {
    const cuenta = getTransactionCuenta(item);
    const sign = outputSign[item.tipo] ?? -1;
    balances[cuenta] += Number(item.monto || 0) * sign;
  });

  balances.caja = Math.round(balances.caja * 100) / 100;
  balances.ahorro = Math.round(balances.ahorro * 100) / 100;
  balances.total = Math.round((balances.caja + balances.ahorro) * 100) / 100;
  return balances;
}

export function summarizePrendas(prendas = []) {
  if (!Array.isArray(prendas) || prendas.length === 0) return "";

  return prendas
    .map((item) => `${item.cantidad} x ${item.nombre} (${moneyFormatter.format(item.precioUnitario)})`)
    .join("; ");
}

export function summarizeCorte(item) {
  const parts = [];
  const prendas = summarizePrendas(item.prendas);

  if (prendas) parts.push(prendas);
  if (item.ingresoExtra?.monto > 0) {
    parts.push(`Extra: ${item.ingresoExtra.concepto || "Sin concepto"} (${moneyFormatter.format(item.ingresoExtra.monto)})`);
  }

  return parts.join("; ") || item.concepto;
}

export function summarizeMovimientos(transacciones = []) {
  return transacciones.reduce(
    (summary, item) => {
      const sign = outputSign[item.tipo] ?? -1;
      if (sign > 0) summary.ingresos += 1;
      if (sign < 0) summary.salidas += 1;
      return summary;
    },
    { ingresos: 0, salidas: 0 }
  );
}

export function validateAccountBalance(cuenta, amount, saldosActuales) {
  const available = saldosActuales[cuenta] ?? 0;
  if (available >= amount) {
    return { valid: true };
  }

  const otherAccount = cuenta === "caja" ? "ahorro" : "caja";
  const otherAvailable = saldosActuales[otherAccount] ?? 0;
  const message = otherAvailable >= amount
    ? `No hay suficiente en ${cuentaLabels[cuenta]}. Puedes sacarlo de ${cuentaLabels[otherAccount]}.`
    : `No hay suficiente dinero en ${cuentaLabels[cuenta]} ni en ${cuentaLabels[otherAccount]}.`;

  return { valid: false, message };
}

export function formatDateForExcel(date) {
  if (!date) return "";

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildReportSummary(transactions, start, end, saldosActuales, fechaInicio, fechaFin) {
  const summary = {
    ingresos: 0,
    gastosOperativos: 0,
    retirosSueldo: 0,
    gastosExternos: 0,
    prendasVendidas: 0,
    cortes: 0,
    ingresosCaja: 0,
    ingresosAhorro: 0,
    salidasCaja: 0,
    salidasAhorro: 0,
    ingresosExtra: 0,
  };

  transactions.forEach((item) => {
    const cuenta = getTransactionCuenta(item);

    if (item.tipo === "ingreso_corte") {
      summary.ingresos += item.monto;
      summary.cortes += 1;
      if (cuenta === "caja") summary.ingresosCaja += item.monto;
      if (cuenta === "ahorro") summary.ingresosAhorro += item.monto;
      summary.prendasVendidas += Array.isArray(item.prendas)
        ? item.prendas.reduce((sum, prenda) => sum + Number(prenda.cantidad || 0), 0)
        : 0;
      summary.ingresosExtra += Number(item.ingresoExtra?.monto || 0);
    }

    if (item.tipo === "gasto_operativo") summary.gastosOperativos += item.monto;
    if (item.tipo === "retiro_sueldo") summary.retirosSueldo += item.monto;
    if (item.tipo === "gasto_externo") summary.gastosExternos += item.monto;

    if (item.tipo !== "ingreso_corte" && cuenta === "caja") summary.salidasCaja += item.monto;
    if (item.tipo !== "ingreso_corte" && cuenta === "ahorro") summary.salidasAhorro += item.monto;
  });

  const totalSalidas = summary.gastosOperativos + summary.retirosSueldo + summary.gastosExternos;
  const saldoPeriodo = summary.ingresos - totalSalidas;
  const ticketPromedio = summary.cortes > 0 ? summary.ingresos / summary.cortes : 0;

  return [
    ["Reporte Epika", "", ""],
    ["Periodo", `${fechaInicio} a ${fechaFin}`, ""],
    ["Generado", formatDateForExcel(new Date()), ""],
    ["Inicio", formatDateForExcel(start), "Fin: " + formatDateForExcel(end)],
    [],
    ["Indicador", "Valor", "Categoria"],
    ["Saldo actual total", saldosActuales.total, "Actual"],
    ["Saldo actual caja", saldosActuales.caja, "Actual"],
    ["Saldo actual ahorro", saldosActuales.ahorro, "Actual"],
    ["Movimientos del periodo", transactions.length, "Periodo"],
    ["Cortes registrados", summary.cortes, "Ventas"],
    ["Prendas vendidas", summary.prendasVendidas, "Ventas"],
    ["Ingresos por ventas", summary.ingresos, "Ingresos"],
    ["Ingresos a caja", summary.ingresosCaja, "Ingresos"],
    ["Ingresos a ahorro", summary.ingresosAhorro, "Ingresos"],
    ["Ingresos extra", summary.ingresosExtra, "Ingresos"],
    ["Gastos operativos", summary.gastosOperativos, "Salidas"],
    ["Retiros de sueldo", summary.retirosSueldo, "Salidas"],
    ["Gastos externos", summary.gastosExternos, "Salidas"],
    ["Salidas desde caja", summary.salidasCaja, "Salidas"],
    ["Salidas desde ahorro", summary.salidasAhorro, "Salidas"],
    ["Total salidas", totalSalidas, "Salidas"],
    ["Saldo del periodo", saldoPeriodo, "Resultado"],
    ["Ticket promedio por corte", ticketPromedio, "Ventas"],
  ];
}

export function buildHistoryRows(transactions) {
  let runningBalance = 0;

  return [
    ["Fecha operacion", "Fecha guardado", "Tipo", "Cuenta", "Concepto", "Monto", "Efecto", "Saldo acumulado", "Usuario", "Prendas", "Extra"],
    ...transactions
      .slice()
      .sort((a, b) => (getTransactionDate(a)?.getTime() ?? 0) - (getTransactionDate(b)?.getTime() ?? 0))
      .map((item) => {
        const sign = outputSign[item.tipo] ?? -1;
        const signedAmount = item.monto * sign;
        runningBalance += signedAmount;

        return [
          formatDateForExcel(getTransactionDate(item)),
          formatDateForExcel(getSavedDate(item)),
          typeLabels[item.tipo] ?? item.tipo,
          cuentaLabels[getTransactionCuenta(item)],
          item.concepto,
          item.monto,
          signedAmount,
          runningBalance,
          item.usuarioEmail ?? "",
          summarizePrendas(item.prendas),
          item.ingresoExtra?.monto > 0 ? `${item.ingresoExtra.concepto || "Sin concepto"}: ${item.ingresoExtra.monto}` : "",
        ];
      }),
  ];
}

export function applySheetStyles(sheet, XLSX, moneyColumns = []) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const border = {
    top: { style: "thin", color: { rgb: "D1D5DB" } },
    bottom: { style: "thin", color: { rgb: "D1D5DB" } },
    left: { style: "thin", color: { rgb: "D1D5DB" } },
    right: { style: "thin", color: { rgb: "D1D5DB" } },
  };

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      if (!sheet[address]) continue;

      const isTitle = row === 0;
      const isHeader = row === 5 || row === 0;
      const isEven = row % 2 === 0;

      sheet[address].s = {
        font: {
          bold: isHeader,
          color: { rgb: isTitle || row === 5 ? "FFFFFF" : "111827" },
          sz: isTitle ? 16 : 11,
        },
        fill: {
          fgColor: { rgb: isTitle ? "16A34A" : row === 5 ? "111827" : isEven ? "F9FAFB" : "FFFFFF" },
        },
        border,
        alignment: {
          vertical: "center",
          wrapText: true,
        },
      };

      if (moneyColumns.includes(col) && typeof sheet[address].v === "number") {
        sheet[address].z = '"$"#,##0.00;[Red]-"$"#,##0.00';
      }
    }
  }
}

export function createExcelReport({ XLSX, transactions, start, end, saldosActuales, fechaInicio, fechaFin }) {
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(buildReportSummary(transactions, start, end, saldosActuales, fechaInicio, fechaFin));
  const historySheet = XLSX.utils.aoa_to_sheet(buildHistoryRows(transactions));

  summarySheet["!cols"] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }];
  summarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  historySheet["!cols"] = [
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 26 },
    { wch: 60 },
    { wch: 34 },
  ];

  applySheetStyles(summarySheet, XLSX, [1]);
  applySheetStyles(historySheet, XLSX, [5, 6, 7]);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Vista general");
  XLSX.utils.book_append_sheet(workbook, historySheet, "Historial completo");

  return workbook;
}
