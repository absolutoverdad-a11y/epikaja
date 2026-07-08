import { GEMINI_API_KEY, GEMINI_MODEL } from "../gemini-local-config.js";

const clothingAnalysisSchema = {
  type: "object",
  properties: {
    nombre_sugerido: {
      type: "string",
      description: "Nombre comercial breve de la prenda.",
    },
    tipo: {
      type: "string",
      description: "Tipo principal de prenda, por ejemplo Playera, Vestido, Pantalon, Blusa.",
    },
    marca: {
      type: "string",
      description: "Marca visible en la prenda. Usa Generica si no hay etiqueta o logotipo claro.",
    },
    color: {
      type: "string",
      description: "Color o combinacion de colores predominante.",
    },
    descripcion: {
      type: "string",
      description: "Descripcion corta de diseno, corte, manga, cuello, estampado y tela aparente.",
    },
    costo_estimado: {
      type: "number",
      description: "Costo estimado aproximado en MXN. Usa 0 si no se puede estimar.",
    },
  },
  required: ["nombre_sugerido", "tipo", "marca", "color", "descripcion", "costo_estimado"],
};

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo preparar la imagen para Gemini."));
    reader.readAsDataURL(blob);
  });
}

function extractBase64Image(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/webp;base64,(.+)$/);
  return match?.[1] || "";
}

function shouldUseServerApi() {
  return !["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

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

function hasExpectedFields(value) {
  return Boolean(
    value
    && typeof value === "object"
    && (
      "nombre_sugerido" in value
      || "tipo" in value
      || "marca" in value
      || "color" in value
      || "descripcion" in value
      || "costo_estimado" in value
    )
  );
}

function findStructuredObject(value) {
  if (!value || typeof value !== "object") return null;
  if (hasExpectedFields(value)) return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredObject(item);
      if (found) return found;
    }
    return null;
  }

  for (const child of Object.values(value)) {
    const found = findStructuredObject(child);
    if (found) return found;
  }

  return null;
}

function collectTextValues(value, texts = []) {
  if (typeof value === "string") {
    texts.push(value);
    return texts;
  }

  if (!value || typeof value !== "object") return texts;

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextValues(item, texts));
    return texts;
  }

  Object.entries(value).forEach(([key, child]) => {
    if (["text", "output_text", "outputText"].includes(key) && typeof child === "string") {
      texts.push(child);
      return;
    }

    collectTextValues(child, texts);
  });

  return texts;
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
        // Continua por si Gemini mando mas de un bloque de texto.
      }
    }
  }

  return null;
}

function extractGeminiPayload(result) {
  const interactionOutput = extractInteractionModelOutput(result);
  if (interactionOutput) return interactionOutput;

  const structured = findStructuredObject(result);
  if (structured) return structured;

  const textValues = collectTextValues(result);
  for (const text of textValues) {
    if (!text.includes("{")) continue;
    try {
      return parseGeminiJson(text);
    } catch (error) {
      // Sigue intentando con otros campos de texto.
    }
  }

  console.warn("Respuesta de Gemini sin JSON reconocible:", result);
  throw new Error("Gemini no devolvio un JSON reconocible.");
}

export async function analizarPrendaConGemini(webpBlob) {
  if (!(webpBlob instanceof Blob)) {
    throw new Error("Primero selecciona una imagen valida.");
  }

  if (!GEMINI_API_KEY || GEMINI_API_KEY === "PEGA_AQUI_TU_API_KEY_DE_GEMINI") {
    throw new Error("Configura tu API Key de Gemini en gemini-local-config.js.");
  }

  const imageDataUrl = await blobToDataUrl(webpBlob);
  const imageBase64 = extractBase64Image(imageDataUrl);

  if (shouldUseServerApi()) {
    const apiResponse = await fetch("/api/analizar-prenda-gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageBase64,
        mimeType: "image/webp",
      }),
    });
    const apiResult = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok) {
      throw new Error(apiResult?.error || "No se pudo analizar la imagen.");
    }

    return normalizeGeminiResponse(apiResult);
  }

  const prompt = [
    "Analiza la foto de una prenda de ropa para inventario de una tienda llamada Epika.",
    "Responde unica y exclusivamente JSON valido, sin markdown, sin explicaciones.",
    "Si no puedes detectar la marca, usa Generica.",
    "El costo_estimado debe ser un numero aproximado en MXN basado en la prenda visible; si no es posible, usa 0.",
    "Estructura exacta:",
    '{"nombre_sugerido":"Playera Tipo Polo","tipo":"Playera","marca":"Zara","color":"Azul Marino","descripcion":"Manga corta, cuello de botones, tela de algodon.","costo_estimado":120}',
  ].join(" ");

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: [
        {
          type: "text",
          text: prompt,
        },
        {
          type: "image",
          data: imageBase64,
          mime_type: "image/webp",
        },
      ],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: clothingAnalysisSchema,
      },
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result?.error?.message || "No se pudo analizar la imagen.");
  }

  return normalizeGeminiResponse(extractGeminiPayload(result));
}
