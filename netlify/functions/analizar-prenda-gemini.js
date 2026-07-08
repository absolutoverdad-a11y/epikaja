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

function extractBase64Image(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/webp;base64,(.+)$/);
  return match?.[1] || "";
}

function parseGeminiJson(text) {
  const cleanText = String(text || "")
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleanText);
}

function normalizeResponse(data) {
  return {
    nombre_sugerido: String(data.nombre_sugerido || "").trim(),
    tipo: String(data.tipo || "").trim(),
    marca: String(data.marca || "Generica").trim() || "Generica",
    color: String(data.color || "").trim(),
    descripcion: String(data.descripcion || "").trim(),
    costo_estimado: Number(data.costo_estimado || 0),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo no permitido." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  if (!apiKey) {
    return json(500, { error: "Gemini no esta configurado en el servidor." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return json(400, { error: "Solicitud invalida." });
  }

  const imageBase64 = extractBase64Image(payload.imageDataUrl);
  if (!imageBase64) {
    return json(400, { error: "La imagen debe enviarse como WebP optimizado." });
  }

  const prompt = [
    "Analiza la foto de una prenda de ropa para inventario de una tienda llamada Epika.",
    "Responde unica y exclusivamente JSON valido, sin markdown, sin explicaciones.",
    "Si no puedes detectar la marca, usa Generica.",
    "El costo_estimado debe ser un numero aproximado en MXN basado en la prenda visible; si no es posible, usa 0.",
    "Estructura exacta:",
    '{"nombre_sugerido":"Playera Tipo Polo","tipo":"Playera","marca":"Zara","color":"Azul Marino","descripcion":"Manga corta, cuello de botones, tela de algodon.","costo_estimado":120}',
  ].join(" ");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: "Eres un asistente experto en catalogacion de ropa. Solo respondes JSON valido." }],
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/webp",
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            response_mime_type: "application/json",
          },
        }),
      }
    );

    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini error", result);
      return json(502, { error: result?.error?.message || "Gemini rechazo el analisis." });
    }

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = parseGeminiJson(text);

    return json(200, normalizeResponse(parsed));
  } catch (error) {
    console.error(error);
    return json(502, { error: "No se pudo analizar la imagen. Intenta con otra foto o llena los campos manualmente." });
  }
};
