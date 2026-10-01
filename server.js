// Минимальный сервер STYX B2B: раздаёт статику и проксирует поиск организаций в DaData.
// Токен DaData берётся только из переменной окружения DADATA_TOKEN и никогда не попадает в браузер.
// Секретный ключ для стандартизации адресов — только из DADATA_SECRET.
// Запуск: DADATA_TOKEN=ваш_токен DADATA_SECRET=ваш_секрет node server.js  (Node.js 18+, без зависимостей)
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

function configFromEnv(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,
    token: env.DADATA_TOKEN || "",
    secret: env.DADATA_SECRET || "",
    partyUrl: env.DADATA_URL || "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party",
    addressUrl: env.DADATA_ADDRESS_URL || "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address",
    cleanUrl: env.DADATA_CLEAN_URL || "https://cleaner.dadata.ru/api/v1/clean/address"
  };
}
const MAX_BODY = 4096;
const ROOT = __dirname;
const PUBLIC_FILES = new Set(["/index.html", "/styles.css", "/app.js", "/catalog.js", "/styx-logo.png",
  "/fonts/montserrat-cyrillic.woff2", "/fonts/montserrat-latin.woff2", "/fonts/montserrat-latin-ext.woff2"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2" };

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleParty(cfg, url, res) {
  const query = (url.searchParams.get("query") || "").trim().slice(0, 300);
  if (query.length < 3) return sendJson(res, 200, { suggestions: [] });
  if (!cfg.token) return sendJson(res, 503, { error: "DADATA_TOKEN is not configured" });

  try {
    const upstream = await fetch(cfg.partyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Token ${cfg.token}` },
      body: JSON.stringify({ query, count: 6, status: ["ACTIVE"] }),
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) return sendJson(res, 502, { error: `DaData responded ${upstream.status}` });
    const payload = await upstream.json();
    // Отдаём клиенту только нужные поля, без лишних данных DaData.
    const suggestions = (payload.suggestions || []).map((item) => ({
      value: item.value,
      data: {
        inn: item.data?.inn,
        kpp: item.data?.kpp,
        ogrn: item.data?.ogrn,
        name: { short_with_opf: item.data?.name?.short_with_opf, full_with_opf: item.data?.name?.full_with_opf },
        address: { unrestricted_value: item.data?.address?.unrestricted_value, value: item.data?.address?.value }
      }
    }));
    return sendJson(res, 200, { suggestions });
  } catch (error) {
    console.error("DaData request failed:", error.message);
    return sendJson(res, 502, { error: "DaData is unavailable" });
  }
}

async function handleAddressSuggest(cfg, url, res) {
  const query = (url.searchParams.get("query") || "").trim().slice(0, 300);
  if (query.length < 3) return sendJson(res, 200, { suggestions: [] });
  if (!cfg.token) return sendJson(res, 503, { error: "DADATA_TOKEN is not configured" });
  try {
    const upstream = await fetch(cfg.addressUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Token ${cfg.token}` },
      body: JSON.stringify({ query, count: 6 }),
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) return sendJson(res, 502, { error: `DaData responded ${upstream.status}` });
    const payload = await upstream.json();
    const suggestions = (payload.suggestions || []).map((item) => ({
      value: item.value,
      unrestricted_value: item.unrestricted_value,
      postal_code: item.data?.postal_code || null
    }));
    return sendJson(res, 200, { suggestions });
  } catch (error) {
    console.error("DaData address request failed:", error.message);
    return sendJson(res, 502, { error: "DaData is unavailable" });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// Стандартизация адреса (DaData «Стандартизация», платный метод): нужен токен и секретный ключ.
async function handleAddressClean(cfg, req, res) {
  let address = "";
  try {
    address = String(JSON.parse(await readBody(req)).address || "").trim().slice(0, 300);
  } catch {
    return sendJson(res, 400, { error: "Invalid body" });
  }
  if (!address) return sendJson(res, 400, { error: "Address is required" });
  if (!cfg.token || !cfg.secret) return sendJson(res, 503, { error: "DADATA_TOKEN or DADATA_SECRET is not configured" });
  try {
    const upstream = await fetch(cfg.cleanUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${cfg.token}`,
        "X-Secret": cfg.secret
      },
      body: JSON.stringify([address]),
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) return sendJson(res, 502, { error: `DaData responded ${upstream.status}` });
    const [item] = await upstream.json();
    if (!item) return sendJson(res, 502, { error: "Empty DaData response" });
    const result = [item.postal_code, item.result].filter(Boolean).join(", ");
    // qc: 0 — адрес распознан уверенно, 1/3 — остались «лишние» части или есть альтернативы, 2 — пустой или мусорный.
    return sendJson(res, 200, { source: item.source, result, postal_code: item.postal_code, qc: item.qc, qc_complete: item.qc_complete });
  } catch (error) {
    console.error("DaData clean request failed:", error.message);
    return sendJson(res, 502, { error: "DaData is unavailable" });
  }
}

async function handleStatic(url, res) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!PUBLIC_FILES.has(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const file = await fs.readFile(path.join(ROOT, pathname));
  res.writeHead(200, { "Content-Type": TYPES[path.extname(pathname)] || "application/octet-stream" });
  res.end(file);
}

function createServer(cfg = configFromEnv()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/dadata/party") return await handleParty(cfg, url, res);
      if (req.method === "GET" && url.pathname === "/api/dadata/address") return await handleAddressSuggest(cfg, url, res);
      if (req.method === "POST" && url.pathname === "/api/dadata/clean-address") return await handleAddressClean(cfg, req, res);
      if (req.method === "GET") return await handleStatic(url, res);
      res.writeHead(405).end();
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}

module.exports = { createServer, configFromEnv };

if (require.main === module) {
  const cfg = configFromEnv();
  createServer(cfg).listen(cfg.port, () => {
    console.log(`STYX B2B: http://localhost:${cfg.port}`);
    if (!cfg.token) console.warn("DADATA_TOKEN не задан: поиск организаций будет работать на тестовых данных.");
    if (!cfg.secret) console.warn("DADATA_SECRET не задан: проверка (стандартизация) адреса будет недоступна.");
  });
}
