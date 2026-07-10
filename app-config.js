window.EPIKA_CONFIG = {
  runtime: "serverless",

  // Si la web y las APIs estan en el mismo dominio de Vercel, dejalo vacio.
  // Si el frontend esta en otro dominio, pon: "https://tu-app.vercel.app"
  apiBaseUrl: "",

  ai: {
    mode: "serverless",
    provider: "groq",
    groq: {
      apiKey: "",
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
    },
    gemini: {
      apiKey: "",
      model: "gemini-3.5-flash",
    },
  },

  cloudinary: {
    mode: "serverless",
    cloudName: "",
    uploadPreset: "",
    folder: "epikaja/productos",
  },

  pos: {
    mode: "serverless",
  },
};
