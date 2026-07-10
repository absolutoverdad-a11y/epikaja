import { auth } from "../firebase-config.js";
import { explainLocalApiError, getApiUrl, getAppConfig, usesServerlessApi } from "./api-client.js";

const analysisPrompt = [
  "Analiza la foto de una prenda de ropa.",
  "Responde unica y exclusivamente JSON valido, sin markdown, sin explicaciones.",
  "Si no puedes detectar la marca, usa Generica.",
  "El costo_estimado debe ser un numero aproximado en MXN basado en la prenda visible; si no es posible, usa 0.",
  "Estructura exacta:",
  '{"nombre_sugerido":"Playera Tipo Polo","tipo":"Playera","marca":"Zara","color":"Azul Marino","descripcion":"Manga corta, cuello de botones, tela de algodon.","costo_estimado":120}',
].join(" ");

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo preparar la imagen para IA."));
    reader.readAsDataURL(blob);
  });
}

function extractBase64Image(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  return {
    mimeType: match?.[1] || "",
    imageBase64: match?.[2] || "",
  };
}

function parseAiJson(value) {
  if (value && typeof value === "object") return value;

  const cleanText = String(value || "")
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleanText);
  } catch (error) {
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw error;
  }
}

function normalizeAiResponse(data) {
  return {
    nombre_sugerido: String(data.nombre_sugerido || "").trim(),
    tipo: String(data.tipo || "").trim(),
    marca: String(data.marca || "Generica").trim() || "Generica",
    color: String(data.color || "").trim(),
    descripcion: String(data.descripcion || "").trim(),
    costo_estimado: Number(data.costo_estimado || 0),
  };
}

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Inicia sesion para analizar imagenes.");
  return user.getIdToken();
}

function extractGeminiPayload(result) {
  const textValues = [];
  const walk = (value) => {
    if (typeof value === "string") {
      textValues.push(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(walk);
  };

  walk(result);

  for (const text of textValues) {
    if (!text.includes("{")) continue;
    try {
      return parseAiJson(text);
    } catch (error) {
      // Continua con el siguiente texto.
    }
  }

  throw new Error("Gemini no devolvio un JSON reconocible.");
}

async function analizarConGroqDirecto(imageBase64, mimeType) {
  const config = getAppConfig().ai?.groq || {};
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "meta-llama/llama-4-scout-17b-16e-instruct").trim();

  if (!apiKey) {
    throw new Error("Configura EPIKA_CONFIG.ai.groq.apiKey en app-config.js.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || "Groq no pudo analizar la imagen.");
  }

  return normalizeAiResponse(parseAiJson(result?.choices?.[0]?.message?.content || ""));
}

async function analizarConGeminiDirecto(imageBase64, mimeType) {
  const config = getAppConfig().ai?.gemini || {};
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "gemini-3.5-flash").trim();

  if (!apiKey) {
    throw new Error("Configura EPIKA_CONFIG.ai.gemini.apiKey en app-config.js.");
  }

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      input: [
        { type: "text", text: analysisPrompt },
        { type: "image", data: imageBase64, mime_type: mimeType },
      ],
      response_format: {
        type: "text",
        mime_type: "application/json",
      },
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result?.error) {
    throw new Error(result?.error?.message || result?.error || "Gemini no pudo analizar la imagen.");
  }

  return normalizeAiResponse(extractGeminiPayload(result));
}

async function analizarConServidor(imageBase64, mimeType) {
  const token = await getAuthToken();
  const apiResponse = await fetch(getApiUrl("/api/analizar-prenda-gemini"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      imageBase64,
      mimeType,
    }),
  });
  const apiResult = await apiResponse.json().catch(() => ({}));

  if (!apiResponse.ok) {
    throw new Error(explainLocalApiError(apiResponse) || apiResult?.error || "No se pudo analizar la imagen.");
  }

  return normalizeAiResponse(apiResult);
}

export async function analizarPrendaConGemini(webpBlob) {
  if (!(webpBlob instanceof Blob)) {
    throw new Error("Primero selecciona una imagen valida.");
  }

  if (webpBlob.type !== "image/webp") {
    throw new Error("La foto debe convertirse a WebP antes de analizarla.");
  }

  const imageDataUrl = await blobToDataUrl(webpBlob);
  const { imageBase64, mimeType } = extractBase64Image(imageDataUrl);

  if (!imageBase64 || !mimeType) {
    throw new Error("No se pudo preparar la foto en este dispositivo. Intenta tomarla de nuevo o subir otra imagen.");
  }

  if (usesServerlessApi("ai")) {
    return analizarConServidor(imageBase64, mimeType);
  }

  const provider = String(getAppConfig().ai?.provider || "groq").trim().toLowerCase();

  if (provider === "gemini") {
    return analizarConGeminiDirecto(imageBase64, mimeType);
  }

  if (provider === "groq") {
    return analizarConGroqDirecto(imageBase64, mimeType);
  }

  throw new Error(`Proveedor de IA no soportado: ${provider}.`);
}
