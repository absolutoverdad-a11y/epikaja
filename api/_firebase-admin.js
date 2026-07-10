const legacyRoles = {
  q9NBlxJIF8aQkn9C5r5xp1Ju0dt1: "admin",
  qfrRyPzhfybit3f38G0JmWajmU43: "vendedor",
};

const defaultAllowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

function normalizePrivateKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");
}

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return {
      ...serviceAccount,
      private_key: normalizePrivateKey(serviceAccount.private_key),
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Faltan variables de Firebase Admin en Vercel.");
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

async function getFirebaseAdmin() {
  try {
    return (await import("firebase-admin")).default;
  } catch (error) {
    throw new Error("Falta instalar firebase-admin. Para probar solo IA en local usa LOCAL_DEV_BYPASS_AUTH=true.");
  }
}

async function getAdminApp() {
  const admin = await getFirebaseAdmin();
  if (admin.apps.length > 0) return admin.apps[0];

  return admin.initializeApp({
    credential: admin.credential.cert(getServiceAccount()),
  });
}

export async function getAdminAuth() {
  return (await getAdminApp()).auth();
}

export async function getAdminDb() {
  return (await getAdminApp()).firestore();
}

export async function getServerTimestamp() {
  const admin = await getFirebaseAdmin();
  return admin.firestore.FieldValue.serverTimestamp();
}

export function getRequestBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch (error) {
      return {};
    }
  }
  return request.body;
}

export function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export async function verifyRequestUser(request, allowedRoles = []) {
  if (process.env.LOCAL_DEV_BYPASS_AUTH === "true") {
    return {
      uid: "local-dev",
      email: "local@epikaja.test",
      rol: allowedRoles[0] || "admin",
    };
  }

  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("Falta token de autenticacion.");
    error.statusCode = 401;
    throw error;
  }

  const decoded = await (await getAdminAuth()).verifyIdToken(token);
  const db = await getAdminDb();
  const userSnapshot = await db.collection("usuarios").doc(decoded.uid).get();
  const roleFromDoc = userSnapshot.exists
    ? String(userSnapshot.data().rol || userSnapshot.data().role || "").trim().toLowerCase()
    : "";
  const rol = roleFromDoc || legacyRoles[decoded.uid] || "";

  if (!rol || (allowedRoles.length > 0 && !allowedRoles.includes(rol))) {
    const error = new Error("No tienes permiso para usar esta funcion.");
    error.statusCode = 403;
    throw error;
  }

  return {
    uid: decoded.uid,
    email: decoded.email || "",
    rol,
  };
}

export function handleApiError(response, error, fallback = "Error interno.") {
  const statusCode = error?.statusCode || 500;
  response.status(statusCode).json({
    error: error?.message || fallback,
  });
}

export function applyCors(request, response) {
  const origin = request.headers.origin || request.headers.Origin || "";
  const envOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([...defaultAllowedOrigins, ...envOrigins]);

  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
