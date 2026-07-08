import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase-config.js";

export async function getUsuarioPerfil(uid) {
  if (!uid) return null;

  const snapshot = await getDoc(doc(db, "usuarios", uid));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const rol = String(data.rol ?? data.role ?? "").trim().toLowerCase();

  return {
    uid,
    ...data,
    rol: rol || null,
  };
}
