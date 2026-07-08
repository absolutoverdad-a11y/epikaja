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

function parseGeminiJson(value) {
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

function normalizeGeminiResponse(data) {
  return {
    nombre_sugerido: String(data.nombre_sugerido || "").trim(),
    tipo: String(data.tipo || "").trim(),
    marca: String(data.marca || "Generica").trim() || "Generica",
    color: String(data.color || "").trim(),
    descripcion: String(data.descripcion || "").trim(),
    costo_estimado: Number(data.costo_estimado || 0),
  };
}

function extractInteractionModelOutput(result) {
  if (!Array.isArray(result?.steps)) return null;

  for (const step of result.steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;

    for (const item of step.content) {
      if (typeof item?.text !== "string") continue;
      try {
        return parseGeminiJson(item.text);
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
      return parseGeminiJson(text);
    } catch (error) {
      // Continua con el siguiente texto.
    }
  }

  throw new Error("Gemini no devolvio un JSON reconocible.");
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

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  if (!apiKey) {
    response.status(500).json({ error: "Falta configurar GEMINI_API_KEY en Vercel." });
    return;
  }

  const { imageBase64, mimeType = "image/webp" } = getRequestBody(request);

  if (!imageBase64) {
    response.status(400).json({ error: "Falta imageBase64." });
    return;
  }

  const prompt = [
    "Analiza la foto de una prenda de ropa para inventario de una tienda llamada Epika.",
    "Responde unica y exclusivamente JSON valido, sin markdown, sin explicaciones.",
    "Si no puedes detectar la marca, usa Generica.",
    "El costo_estimado debe ser un numero aproximado en MXN basado en la prenda visible; si no es posible, usa 0.",
    "Estructura exacta:",
    '{"nombre_sugerido":"Playera Tipo Polo","tipo":"Playera","marca":"Zara","color":"Azul Marino","descripcion":"Manga corta, cuello de botones, tela de algodon.","costo_estimado":120}',
  ].join(" ");

  const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      input: [
        { type: "text", text: prompt },
        { type: "image", data: imageBase64, mime_type: mimeType },
      ],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: clothingAnalysisSchema,
      },
    }),
  });

  const result = await geminiResponse.json().catch(() => ({}));

  if (!geminiResponse.ok) {
    response.status(geminiResponse.status).json({
      error: result?.error?.message || "No se pudo analizar la imagen.",
    });
    return;
  }

  response.status(200).json(normalizeGeminiResponse(extractGeminiPayload(result)));
}
