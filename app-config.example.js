window.EPIKA_CONFIG = {
  runtime: "static",
  apiBaseUrl: "",
  ai: {
    mode: "direct",
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
    mode: "unsigned",
    cloudName: "",
    uploadPreset: "",
    folder: "epikaja/productos",
  },
  pos: {
    mode: "client",
  },
};
