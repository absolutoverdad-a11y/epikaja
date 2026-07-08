const fs = require("fs");
const http = require("http");
const path = require("path");
const { handler: subirImagenProducto } = require("./netlify/functions/subir-imagen-producto");

const rootDir = __dirname;
const port = Number(process.env.PORT || 5500);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function loadEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 6 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload demasiado grande."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeFilePath(urlPath) {
  const requestedPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalizedPath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(rootDir, normalizedPath));

  if (!filePath.startsWith(rootDir)) return null;
  return filePath;
}

async function handleFunction(req, res) {
  try {
    const body = await getBody(req);
    const result = await subirImagenProducto({
      httpMethod: req.method,
      headers: req.headers,
      body,
    });

    res.writeHead(result.statusCode, result.headers || {});
    res.end(result.body || "");
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
  }
}

function handleStatic(req, res) {
  const filePath = safeFilePath(req.url);
  if (!filePath) {
    send(res, 403, "Ruta no permitida.");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Archivo no encontrado.");
      return;
    }

    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, data, contentType);
  });
}

loadEnv();

http
  .createServer(async (req, res) => {
    if (req.url.startsWith("/.netlify/functions/subir-imagen-producto")) {
      await handleFunction(req, res);
      return;
    }

    handleStatic(req, res);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Servidor local listo: http://127.0.0.1:${port}`);
    console.log(`Inventario: http://127.0.0.1:${port}/inventario.html`);
  });
