

export const DEFAULT_PRODUCT_IMAGE_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="#f3f4f6"/>
  <rect x="170" y="130" width="260" height="330" rx="36" fill="#ffffff" stroke="#d1d5db" stroke-width="12"/>
  <path d="M230 140c16 42 124 42 140 0" fill="none" stroke="#d1d5db" stroke-width="12" stroke-linecap="round"/>
  <text x="300" y="515" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#6b7280">Sin Foto</text>
</svg>
`)}`;

export function normalizeCode(value) {
  return String(value ?? "").trim().replace(/\s+/g, "-").toUpperCase();
}

export function parseInventoryAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100) / 100;
}

export function parseStock(value) {
  if (value === "" || value === null || value === undefined) return 1;
  const stock = Number(value);
  if (!Number.isInteger(stock) || stock < 0) return null;
  return stock;
}

export function calcularMargenGanancia(precioVenta, costoCompra) {
  const precio = Number(precioVenta || 0);
  const costo = Number(costoCompra || 0);
  const ganancia = Math.round((precio - costo) * 100) / 100;
  const porcentaje = costo > 0 ? Math.round((ganancia / costo) * 10000) / 100 : 0;

  return {
    ganancia,
    porcentaje,
  };
}

function segment(value, fallback, length = 3) {
  const clean = normalizeCode(value).replace(/[^A-Z0-9]/g, "");
  return (clean || fallback).slice(0, length);
}

export function generarSku({ tipoPrenda = "PRENDA", color = "VAR", talla = "UNI" } = {}) {
  const prefix = [
    segment(tipoPrenda, "PRE", 6),
    segment(color, "V", 1),
    segment(talla, "UNI", 3),
  ].join("-");
  const suffix = String(Math.floor(Math.random() * 900) + 100);

  return `${prefix}-${suffix}`;
}

export function generarCodigoAleatorio() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

export function buildProductoPayload({
  codigoBarras,
  nombre,
  talla,
  costoCompra,
  precioVenta,
  ubicacion,
  color,
  marca,
  descripcion,
  costoEstimado,
  tipoPrenda,
  stock,
  existente = null,
}) {
  const codigo = normalizeCode(codigoBarras);
  const costo = parseInventoryAmount(costoCompra);
  const costoIa = costoEstimado === "" || costoEstimado === null || costoEstimado === undefined
    ? null
    : parseInventoryAmount(costoEstimado);
  const precio = parseInventoryAmount(precioVenta);
  const piezas = parseStock(stock);
  const ubicacionFinal = String(ubicacion ?? "").trim() || "tienda";

  if (!codigo) return { error: "Ingresa o genera un codigo para la prenda." };
  if (!String(nombre ?? "").trim()) return { error: "Ingresa el nombre de la prenda." };
  if (!String(talla ?? "").trim()) return { error: "Ingresa una talla." };
  if (costo === null) return { error: "Ingresa un costo de compra valido." };
  if (costoIa === null && costoEstimado !== "" && costoEstimado !== null && costoEstimado !== undefined) return { error: "Ingresa un costo estimado valido." };
  if (precio === null) return { error: "Ingresa un precio de venta valido." };
  if (piezas === null) return { error: "Ingresa un stock valido." };

  return {
    producto: {
      codigoBarras: codigo,
      nombre: String(nombre).trim(),
      talla: String(talla ?? "").trim(),
      costoCompra: costo,
      precioVenta: precio,
      ubicacion: ubicacionFinal,
      color: String(color ?? "").trim(),
      marca: String(marca ?? "").trim(),
      descripcion: String(descripcion ?? "").trim(),
      costoEstimado: costoIa ?? 0,
      tipoPrenda: String(tipoPrenda ?? "").trim(),
      stock: piezas,
      creadoEn: existente?.creadoEn,
    },
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo convertir la imagen a WebP."));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function loadImageFromFile(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      // Algunos navegadores no decodifican HEIC/HEIF; el fallback intentara usar Image.
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la imagen. Prueba con JPG, PNG o WebP si tu navegador no soporta HEIC."));
    };

    image.src = objectUrl;
  });
}

export async function procesarImagenProducto(file, { maxWidth = 600, quality = 0.75 } = {}) {
  if (!file) return null;
  if (!String(file.type || "").startsWith("image/") && !/\.(heic|heif)$/i.test(file.name || "")) {
    throw new Error("Selecciona un archivo de imagen valido.");
  }

  const source = await loadImageFromFile(file);
  const originalWidth = source.width;
  const originalHeight = source.height;

  if (!originalWidth || !originalHeight) {
    throw new Error("La imagen no tiene dimensiones validas.");
  }

  const scale = originalWidth > maxWidth ? maxWidth / originalWidth : 1;
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  if (source.close) source.close();

  const blob = await canvasToBlob(canvas, "image/webp", quality);

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    sizeKb: Math.round((blob.size / 1024) * 10) / 10,
    width,
    height,
  };
}
