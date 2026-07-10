import { applyCors, getRequestBody, handleApiError, verifyRequestUser } from "./_firebase-admin.js";

const PROVIDERS = {
  gemini: {
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-3.5-flash",
    modelEnv: "GEMINI_MODEL",
  },
  groq: {
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    modelEnv: "GROQ_MODEL",
  },
};

const clothingAnalysisSchema = {
  type: "object",
  properties: {
    nombre_sugerido: { type: "string" },
    tipo: { type: "string" },
    marca: { type: "string" },
    color: { type: "string" },
    descripcion: { type: "string" },
    costo_estimado: { type: "number" },
  },
  required: ["nombre_sugerido", "tipo", "marca", "color", "descripcion", "costo_estimado"],
};

const analysisPrompt = [
  "Analiza la foto de una prenda de ropa para inventario de una tienda llamada Epika.",
  "Responde unica y exclusivamente JSON valido, sin markdown, sin explicaciones.",
  "Si no puedes detectar la marca, usa Generica.",
  "El costo_estimado debe ser un numero aproximado en MXN basado en la prenda visible; si no es posible, usa 0.",
  "Estructura exacta:",
  '{"nombre_sugerido":"Playera Tipo Polo","tipo":"Playera","marca":"Zara","color":"Azul Marino","descripcion":"Manga corta, cuello de botones, tela de algodon.","costo_estimado":120}',
].join(" ");

function getAiProviderConfig() {
  const provider = String(process.env.AI_PROVIDER || "gemini").trim().toLowerCase();
  const config = PROVIDERS[provider];

  if (!config) {
    const validProviders = Object.keys(PROVIDERS).join(", ");
    throw Object.assign(new Error(`Proveedor de IA no soportado: ${provider}. Usa uno de: ${validProviders}.`), {
      statusCode: 500,
    });
  }

  return {
    provider,
    apiKey: process.env[config.apiKeyEnv],
    apiKeyEnv: config.apiKeyEnv,
    model: process.env[config.modelEnv] || config.defaultModel,
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

function normalizeAiErrorMessage(message, provider = "IA") {
  const text = String(message || "");
  const lowerText = text.toLowerCase();
  const providerName = provider === "groq" ? "Groq" : provider === "gemini" ? "Gemini" : "La IA";

  if (
    lowerText.includes("high demand")
    || lowerText.includes("spikes in demand")
    || lowerText.includes("try again later")
    || lowerText.includes("overloaded")
    || lowerText.includes("temporarily unavailable")
  ) {
    return `${providerName} esta saturado por alta demanda. Espera unos minutos e intenta analizar la prenda otra vez.`;
  }

  if (
    lowerText.includes("rate limit")
    || lowerText.includes("too many requests")
    || lowerText.includes("quota")
  ) {
    return `${providerName} llego al limite de uso temporal. Espera un momento o cambia de proveedor de IA.`;
  }

  return text || "No se pudo analizar la imagen.";
}

function extractInteractionModelOutput(result) {
  if (!Array.isArray(result?.steps)) return null;

  for (const step of result.steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;

    for (const item of step.content) {
      if (typeof item?.text !== "string") continue;
      try {
        return parseAiJson(item.text);
      } catch (error) {
        // Continua buscando otro bloque de texto.
      }
    }
  }

  return null;
}

function extractGeminiPayload(result) {
  const fromInteraction = extractInteractionModelOutput(result);
  if (fromInteraction) return fromInteraction;

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

function extractGroqPayload(result) {
  const content = result?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq no devolvio contenido reconocible.");
  return parseAiJson(content);
}

async function callGemini({ apiKey, model, imageBase64, mimeType }) {
  const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
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
        schema: clothingAnalysisSchema,
      },
    }),
  });

  const result = await aiResponse.json().catch(() => ({}));

  if (result?.error) {
    throw Object.assign(new Error(result.error?.message || result.error), {
      statusCode: aiResponse.ok ? 503 : aiResponse.status,
      providerCode: "GEMINI_UNAVAILABLE",
    });
  }

  if (!aiResponse.ok) {
    throw Object.assign(new Error(result?.error?.message || "Gemini no pudo analizar la imagen."), {
      statusCode: aiResponse.status,
    });
  }

  return extractGeminiPayload(result);
}

async function callGroq({ apiKey, model, imageBase64, mimeType }) {
  const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
    }),
  });

  const result = await aiResponse.json().catch(() => ({}));

  if (result?.error) {
    throw Object.assign(new Error(result.error?.message || result.error), {
      statusCode: aiResponse.ok ? 503 : aiResponse.status,
      providerCode: "GROQ_UNAVAILABLE",
    });
  }

  if (!aiResponse.ok) {
    throw Object.assign(new Error(result?.error?.message || "Groq no pudo analizar la imagen."), {
      statusCode: aiResponse.status,
    });
  }

  return extractGroqPayload(result);
}

async function analyzeWithProvider({ provider, apiKey, model, imageBase64, mimeType }) {
  if (provider === "groq") {
    return callGroq({ apiKey, model, imageBase64, mimeType });
  }

  return callGemini({ apiKey, model, imageBase64, mimeType });
}

export default async function handler(request, response) {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  try {
    await verifyRequestUser(request, ["admin"]);
  } catch (error) {
    handleApiError(response, error, "No se pudo validar la sesion.");
    return;
  }

  let aiConfig;
  try {
    aiConfig = getAiProviderConfig();
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
    return;
  }

  if (!aiConfig.apiKey) {
    response.status(500).json({
      error: `Falta configurar ${aiConfig.apiKeyEnv} en Vercel.`,
    });
    return;
  }

  const { imageBase64, mimeType = "image/webp" } = getRequestBody(request);
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();

  if (!imageBase64 || typeof imageBase64 !== "string") {
    response.status(400).json({ error: "No se recibio la foto procesada. Intenta tomarla de nuevo o subir otra imagen." });
    return;
  }

  if (normalizedMimeType !== "image/webp") {
    response.status(400).json({ error: "La imagen debe enviarse convertida a WebP." });
    return;
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
    response.status(400).json({ error: "La imagen base64 no es valida." });
    return;
  }

  if (imageBase64.length > 2_500_000) {
    response.status(413).json({ error: "La imagen es demasiado grande." });
    return;
  }

  try {
    const data = await analyzeWithProvider({
      ...aiConfig,
      imageBase64,
      mimeType: normalizedMimeType,
    });

    response.status(200).json({
      ...normalizeAiResponse(data),
      proveedorIa: aiConfig.provider,
      modeloIa: aiConfig.model,
    });
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: normalizeAiErrorMessage(error.message, aiConfig.provider),
      code: error.providerCode || "AI_ANALYSIS_FAILED",
      provider: aiConfig.provider,
    });
  }
}
