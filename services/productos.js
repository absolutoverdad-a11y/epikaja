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
import { explainLocalApiError, getApiUrl, getAppConfig, usesServerlessApi } from "./api-client.js";

const productosRef = collection(db, "productos");

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

  if (webpBlob.type !== "image/webp") {
    throw new Error("La imagen debe estar convertida a WebP antes de subirla.");
  }

  if (!usesServerlessApi("cloudinary")) {
    const config = getAppConfig().cloudinary || {};
    const cloudName = String(config.cloudName || "").trim();
    const uploadPreset = String(config.uploadPreset || "").trim();
    const folder = String(config.folder || "epikaja/productos").trim();

    if (!cloudName || !uploadPreset) {
      throw new Error("Configura cloudinary.cloudName y cloudinary.uploadPreset en app-config.js.");
    }

    const formData = new FormData();
    formData.append("file", webpBlob, `${normalizedCode}.webp`);
    formData.append("upload_preset", uploadPreset);
    formData.append("folder", folder);
    formData.append("public_id", normalizedCode);

    const directResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: formData,
    });
    const directResult = await directResponse.json().catch(() => ({}));

    if (!directResponse.ok) {
      throw new Error(directResult?.error?.message || "No se pudo subir la imagen a Cloudinary.");
    }

    return {
      imagenUrl: directResult.secure_url,
      imagenPath: directResult.public_id,
    };
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error("Inicia sesion para subir imagenes.");
  }

  const token = await user.getIdToken();
  const response = await fetch(getApiUrl("/api/subir-imagen-producto"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      codigo: normalizedCode,
      imageDataUrl: await blobToDataUrl(webpBlob),
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(explainLocalApiError(response) || result?.error || "No se pudo subir la imagen a Cloudinary.");
  }

  return {
    imagenUrl: result.imagenUrl,
    imagenPath: result.imagenPath,
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
