import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { GoogleAuthProvider, getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBrjR325ISH0BnjUnDSGhQcx63ULR6-Anw",
  authDomain: "epik-6d50f.firebaseapp.com",
  projectId: "epik-6d50f",
  storageBucket: "epik-6d50f.firebasestorage.app",
  messagingSenderId: "466769635374",
  appId: "1:466769635374:web:b34a7a6c860f4821dd57bf",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
