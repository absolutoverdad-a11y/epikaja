import crypto from "node:crypto";

function signCloudinaryParams(params, apiSecret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${payload}${apiSecret}`)
    .digest("hex");
}

function getRequestBody(request) {
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

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_FOLDER || "epikaja/productos";

  if (!cloudName || !apiKey || !apiSecret) {
    response.status(500).json({ error: "Faltan variables de Cloudinary en Vercel." });
    return;
  }

  const { codigo, imageDataUrl } = getRequestBody(request);
  const normalizedCode = String(codigo || "").trim();

  if (!normalizedCode || !imageDataUrl) {
    response.status(400).json({ error: "Faltan codigo o imageDataUrl." });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = normalizedCode;
  const paramsToSign = {
    folder,
    overwrite: true,
    public_id: publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(paramsToSign, apiSecret);
  const formData = new FormData();

  formData.append("file", imageDataUrl);
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("signature", signature);
  formData.append("folder", folder);
  formData.append("public_id", publicId);
  formData.append("overwrite", "true");

  const cloudinaryResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  const result = await cloudinaryResponse.json().catch(() => ({}));

  if (!cloudinaryResponse.ok) {
    response.status(cloudinaryResponse.status).json({
      error: result?.error?.message || "No se pudo subir la imagen a Cloudinary.",
    });
    return;
  }

  response.status(200).json({
    imagenUrl: result.secure_url,
    imagenPath: result.public_id,
  });
}
