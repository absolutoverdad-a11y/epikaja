import {
  applyCors,
  getAdminDb,
  getRequestBody,
  getServerTimestamp,
  handleApiError,
  verifyRequestUser,
} from "./_firebase-admin.js";

function normalizeCartItem(item) {
  const codigo = String(item?.codigoBarras ?? item?.id ?? "").trim();
  const cantidad = Number.parseInt(item?.cantidad, 10);

  return {
    codigo,
    cantidad: Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 0,
  };
}

export default async function handler(request, response) {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  let user;
  try {
    user = await verifyRequestUser(request, ["admin"]);
  } catch (error) {
    handleApiError(response, error, "No se pudo validar la sesion.");
    return;
  }

  const { cart } = getRequestBody(request);
  const items = Array.isArray(cart) ? cart.map(normalizeCartItem) : [];

  if (items.length === 0 || items.length > 100 || items.some((item) => !item.codigo || item.cantidad <= 0)) {
    response.status(400).json({ error: "Carrito invalido." });
    return;
  }

  const mergedItems = new Map();
  items.forEach((item) => {
    mergedItems.set(item.codigo, (mergedItems.get(item.codigo) || 0) + item.cantidad);
  });

  const db = await getAdminDb();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const productosVendidos = [];
      let totalVenta = 0;
      let totalPiezas = 0;

      for (const [codigo, cantidad] of mergedItems.entries()) {
        const productRef = db.collection("productos").doc(codigo);
        const productSnap = await transaction.get(productRef);

        if (!productSnap.exists) {
          throw new Error(`El producto ${codigo} no existe en inventario.`);
        }

        const producto = productSnap.data();
        const currentStock = Number(producto.stock || 0);
        const precioUnitario = Number(producto.precioVenta || 0);

        if (currentStock < cantidad) {
          throw new Error(`Stock insuficiente para ${producto.nombre || codigo}. Disponible: ${currentStock}`);
        }

        if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
          throw new Error(`Precio invalido para ${producto.nombre || codigo}.`);
        }

        const subtotal = Math.round(precioUnitario * cantidad * 100) / 100;
        totalVenta += subtotal;
        totalPiezas += cantidad;

        transaction.update(productRef, {
          stock: currentStock - cantidad,
        });

        productosVendidos.push({
          codigo,
          nombre: String(producto.nombre || "Producto sin nombre"),
          cantidad,
          precioUnitario,
          subtotal,
        });
      }

      totalVenta = Math.round(totalVenta * 100) / 100;
      const transactionRef = db.collection("transacciones").doc();

      transaction.set(transactionRef, {
        tipo: "ingreso_corte",
        monto: totalVenta,
        concepto: `Venta POS: ${totalPiezas} prendas`,
        cuenta: "caja",
        prendas: productosVendidos,
        ingresoExtra: null,
        origen: "pos",
        usuarioUid: user.uid,
        usuarioEmail: user.email,
        fecha: await getServerTimestamp(),
      });

      return {
        transaccionId: transactionRef.id,
        totalVenta,
        totalPiezas,
      };
    });

    response.status(200).json(result);
  } catch (error) {
    handleApiError(response, error, "No se pudo procesar la venta.");
  }
}
