const crypto = require("crypto");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(payload),
  };
}

function sanitizePublicId(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 120);
}

function signParams(params, apiSecret) {
  const signatureBase = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${signatureBase}${apiSecret}`)
    .digest("hex");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo no permitido." });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_PRODUCT_FOLDER || "epikaja/productos";

  if (!cloudName || !apiKey || !apiSecret) {
    return json(500, { error: "Cloudinary no esta configurado en Netlify." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return json(400, { error: "Solicitud invalida." });
  }

  const publicId = sanitizePublicId(payload.codigo);
  const imageDataUrl = String(payload.imageDataUrl || "");

  if (!publicId) {
    return json(400, { error: "Falta el codigo del producto." });
  }

  if (!imageDataUrl.startsWith("data:image/webp;base64,")) {
    return json(400, { error: "La imagen debe llegar procesada como WebP." });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams = {
    folder,
    overwrite: "true",
    public_id: publicId,
    timestamp,
  };

  const formData = new FormData();
  formData.append("file", imageDataUrl);
  formData.append("api_key", apiKey);
  formData.append("folder", folder);
  formData.append("overwrite", "true");
  formData.append("public_id", publicId);
  formData.append("timestamp", String(timestamp));
  formData.append("signature", signParams(signedParams, apiSecret));

  try {
    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    const result = await cloudinaryResponse.json();

    if (!cloudinaryResponse.ok) {
      console.error("Cloudinary upload error", result);
      return json(502, {
        error: result?.error?.message || "Cloudinary rechazo la subida.",
      });
    }

    return json(200, {
      imagenUrl: result.secure_url,
      imagenPath: result.public_id,
      bytes: result.bytes,
      format: result.format,
    });
  } catch (error) {
    console.error(error);
    return json(502, {
      error: "Error al subir la imagen. Por favor, verifica tu conexion e intentalo de nuevo",
    });
  }
};
