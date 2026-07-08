import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth, db, googleProvider } from "../firebase-config.js";

const productosRef = collection(db, "productos");
const cloudinaryCloudName = "akuqvc4x";
const cloudinaryUploadPreset = "epikaja_productos";
const cloudinaryFolder = "epikaja/productos";

function shouldUseServerApi() {
  return !["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo preparar la imagen."));
    reader.readAsDataURL(blob);
  });
}

export function listenAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

export async function buscarProductoPorCodigo(codigo) {
  const normalizedCode = String(codigo ?? "").trim();
  if (!normalizedCode) return null;

  const productRef = doc(db, "productos", normalizedCode);
  const snapshot = await getDoc(productRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function guardarProducto(producto, user) {
  const codigo = String(producto.codigoBarras ?? "").trim();
  if (!codigo) {
    throw new Error("El producto necesita un codigo para guardarse.");
  }

  const productRef = doc(db, "productos", codigo);

  await setDoc(
    productRef,
    {
      ...producto,
      codigoBarras: codigo,
      costoCompra: Number(producto.costoCompra || 0),
      costoEstimado: Number(producto.costoEstimado || 0),
      precioVenta: Number(producto.precioVenta || 0),
      stock: Number(producto.stock || 0),
      actualizadoPor: user?.email ?? "",
      actualizadoUid: user?.uid ?? "",
      actualizadoEn: serverTimestamp(),
      creadoEn: producto.creadoEn ?? serverTimestamp(),
    },
    { merge: true }
  );
}

export async function subirImagenProducto(codigo, webpBlob) {
  const normalizedCode = String(codigo ?? "").trim();
  if (!normalizedCode) {
    throw new Error("La imagen necesita el codigo del producto.");
  }

  if (!(webpBlob instanceof Blob)) {
    throw new Error("La imagen procesada no es valida.");
  }

  if (shouldUseServerApi()) {
    const response = await fetch("/api/subir-imagen-producto", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        codigo: normalizedCode,
        imageDataUrl: await blobToDataUrl(webpBlob),
      }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result?.error || "No se pudo subir la imagen a Cloudinary.");
    }

    return {
      imagenUrl: result.imagenUrl,
      imagenPath: result.imagenPath,
    };
  }

  const formData = new FormData();
  
  // 1. Añadimos SOLO lo permitido para subidas no firmadas
  formData.append("file", webpBlob, `${normalizedCode}.webp`);
  formData.append("upload_preset", cloudinaryUploadPreset);
  formData.append("folder", cloudinaryFolder); 
  // ❌ ELIMINADOS: public_id y overwrite para evitar el Error 400

  // 2. Ejecutar la petición limpia sin Headers manuales
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  // 3. Capturar el error real de Cloudinary si llega a fallar algo más
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    // Accedemos a result.error.message porque Cloudinary devuelve un objeto de error estructurado
    throw new Error(result.error?.message || "No se pudo subir la imagen a Cloudinary.");
  }

  const result = await response.json();

  return {
    imagenUrl: result.secure_url,
    imagenPath: result.public_id,
  };
}

export function listenProductos(onData, onError) {
  const productosQuery = query(productosRef, orderBy("nombre", "asc"));

  return onSnapshot(
    productosQuery,
    (snapshot) => {
      onData(snapshot.docs.map((productDoc) => ({
        id: productDoc.id,
        ...productDoc.data(),
      })));
    },
    onError
  );
}
