import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth, db, googleProvider } from "../firebase-config.js";

const transaccionesRef = collection(db, "transacciones");
const saldosRef = doc(db, "configuracion", "saldos");

export function listenAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

export function listenSaldos(onData, onError) {
  return onSnapshot(
    saldosRef,
    (snapshot) => {
      const data = snapshot.data() ?? {};
      onData({
        caja: Number(data.caja || 0),
        ahorro: Number(data.ahorro || 0),
      });
    },
    onError
  );
}

export function listenTransacciones(onData, onError) {
  const transaccionesQuery = query(transaccionesRef, orderBy("fecha", "desc"));

  return onSnapshot(
    transaccionesQuery,
    (snapshot) => {
      onData(snapshot.docs.map((transactionDoc) => ({
        id: transactionDoc.id,
        ...transactionDoc.data(),
      })));
    },
    onError
  );
}

export async function saveTransaction({ tipo, monto, concepto, cuenta, prendas = [], ingresoExtra = null, user }) {
  await addDoc(transaccionesRef, {
    tipo,
    monto,
    concepto,
    cuenta,
    prendas,
    ingresoExtra,
    usuarioEmail: user?.email ?? "",
    usuarioUid: user?.uid ?? "",
    fecha: serverTimestamp(),
  });
}

export async function saveSaldos({ caja, ahorro, user }) {
  await setDoc(
    saldosRef,
    {
      caja,
      ahorro,
      actualizadoPor: user?.email ?? "",
      actualizadoEn: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getTransaccionesByFecha({ start, end }) {
  const reportQuery = query(
    transaccionesRef,
    where("fecha", ">=", Timestamp.fromDate(start)),
    where("fecha", "<=", Timestamp.fromDate(end)),
    orderBy("fecha", "asc")
  );

  const snapshot = await getDocs(reportQuery);
  return snapshot.docs.map((transactionDoc) => ({
    id: transactionDoc.id,
    ...transactionDoc.data(),
  }));
}
