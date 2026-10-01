// Сервер STYX B2B: страница кабинета, кабинет менеджера (/admin), API и прокси поиска организаций в DaData.
// Клиенты, сессии и заказы хранятся в SQLite (DB_PATH), пароли — только в виде хеша scrypt (server/api.js).
// Токен DaData берётся только из переменной окружения DADATA_TOKEN и никогда не попадает в браузер.
// Секретный ключ для стандартизации адресов — только из DADATA_SECRET.
// Заказы делятся по юрлицам STYX и уходят письмом с бланками Excel (server/orders.js); почта — SMTP_* и ORDER_MAIL_*.
// Запуск: npm install && node server.js  (Node.js 22.13+). Все настройки — в README и deploy/README.md.
// Команды: node server.js create-manager <email> "<имя>"  — менеджер; node server.js backup — резервная копия базы.
const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createTransport } = require("./server/mail");
const { loadCatalog } = require("./server/orders");
const { openDb } = require("./server/db");
const { createApi } = require("./server/api");
const { hashPassword, passwordProblem } = require("./server/auth");

function configFromEnv(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,
    token: env.DADATA_TOKEN || "",
    secret: env.DADATA_SECRET || "",
    partyUrl: env.DADATA_URL || "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party",
    addressUrl: env.DADATA_ADDRESS_URL || "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address",
    cleanUrl: env.DADATA_CLEAN_URL || "https://cleaner.dadata.ru/api/v1/clean/address",
    dbPath: env.DB_PATH || path.join(__dirname, "data", "styx.sqlite"),
    backupDir: env.BACKUP_DIR || path.join(__dirname, "data", "backups"),
    backupKeep: Number(env.BACKUP_KEEP) || 14,
    appUrl: env.APP_URL || "",
    requireApproval: env.REQUIRE_APPROVAL !== "0",
    trustProxy: env.TRUST_PROXY === "1",
    cookieSecure: env.COOKIE_SECURE === "1",
    mail: {
      smtpUrl: env.SMTP_URL || "",
      host: env.SMTP_HOST || "",
      port: Number(env.SMTP_PORT) || 465,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE !== "0" : (Number(env.SMTP_PORT) || 465) === 465,
      user: env.SMTP_USER || "",
      pass: env.SMTP_PASS || "",
      from: env.ORDER_MAIL_FROM || env.SMTP_USER || "",
      to: env.ORDER_MAIL_TO || "",
      clientCopy: env.ORDER_MAIL_CLIENT_COPY !== "0",
      outboxDir: env.ORDER_MAIL_OUTBOX || ""
    }
  };
}
const MAX_BODY = 4096;
const ROOT = __dirname;
const PUBLIC_FILES = new Set(["/index.html", "/styles.css", "/app.js", "/catalog.js", "/styx-logo.png",
  "/admin.html", "/admin.js", "/admin.css", "/privacy.html",
  "/fonts/montserrat-cyrillic.woff2", "/fonts/montserrat-latin.woff2", "/fonts/montserrat-latin-ext.woff2"]);
const ALIASES = { "/": "/index.html", "/admin": "/admin.html", "/admin/": "/admin.html", "/privacy": "/privacy.html" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};
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

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error("Body too large"));
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
  const pathname = ALIASES[url.pathname] || url.pathname;
  if (!PUBLIC_FILES.has(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const file = await fs.readFile(path.join(ROOT, pathname));
  // Страницы и скрипты не кэшируем надолго, чтобы после обновления сервера клиенты сразу получали новую версию.
  res.writeHead(200, { "Content-Type": TYPES[path.extname(pathname)] || "application/octet-stream", "Cache-Control": pathname.startsWith("/fonts/") ? "public, max-age=2592000" : "no-cache" });
  res.end(file);
}

function createServer(cfg = configFromEnv(), deps = {}) {
  const db = deps.db || (deps.db = openDb(cfg.dbPath));
  const api = createApi({
    cfg,
    db,
    getTransport: () => (deps.transport === undefined ? (deps.transport = createTransport(cfg.mail || {})) : deps.transport),
    getCatalog: () => deps.catalog || (deps.catalog = loadCatalog())
  });
  const server = http.createServer(async (req, res) => {
    Object.entries(SECURITY_HEADERS).forEach(([name, value]) => res.setHeader(name, value));
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/dadata/party") return await handleParty(cfg, url, res);
      if (req.method === "GET" && url.pathname === "/api/dadata/address") return await handleAddressSuggest(cfg, url, res);
      if (req.method === "POST" && url.pathname === "/api/dadata/clean-address") return await handleAddressClean(cfg, req, res);
      if (await api(req, res, url)) return;
      if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
      if (req.method === "GET") return await handleStatic(url, res);
      res.writeHead(405).end();
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on("close", () => { if (!deps.keepDb) db.close(); });
  return server;
}

// Резервная копия базы: файл styx-ГГГГ-ММ-ДД.sqlite в BACKUP_DIR, старше BACKUP_KEEP дней — удаляются.
function backupDatabase(db, cfg) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(cfg.backupDir, `styx-${day}.sqlite`);
  db.backupTo(file);
  const cutoff = Date.now() - cfg.backupKeep * 24 * 60 * 60 * 1000;
  for (const name of fsSync.readdirSync(cfg.backupDir)) {
    const match = name.match(/^styx-(\d{4}-\d{2}-\d{2})\.sqlite$/);
    if (match && new Date(match[1]).getTime() < cutoff) fsSync.rmSync(path.join(cfg.backupDir, name));
  }
  return file;
}

// Менеджер создаётся из консоли сервера. Пароль — MANAGER_PASSWORD или будет сгенерирован и показан один раз.
function createManager(cfg, email, name) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Использование: node server.js create-manager <email> "<имя>"');
  const db = openDb(cfg.dbPath);
  const password = process.env.MANAGER_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const existing = db.userByEmail(email.toLowerCase());
  if (existing) {
    db.setPassword(existing.id, hashPassword(password));
    db.raw.prepare("UPDATE users SET role = 'manager', status = 'active' WHERE id = ?").run(existing.id);
  } else {
    db.createUser({ email: email.toLowerCase(), name: name || "Менеджер STYX", passwordHash: hashPassword(password), role: "manager", status: "active" });
  }
  db.close();
  return password;
}

module.exports = { createServer, configFromEnv, backupDatabase, createManager };

if (require.main === module) {
  const cfg = configFromEnv();
  const [command, ...args] = process.argv.slice(2);
  if (command === "create-manager") {
    const password = createManager(cfg, args[0], args[1]);
    console.log(`Менеджер ${args[0]} готов. Вход: ${cfg.appUrl || "http://localhost:" + cfg.port}/admin`);
    if (!process.env.MANAGER_PASSWORD) console.log(`Пароль: ${password}  (сохраните его, повторно он не показывается)`);
    process.exit(0);
  }
  if (command === "backup") {
    const db = openDb(cfg.dbPath);
    console.log(`Резервная копия: ${backupDatabase(db, cfg)}`);
    db.close();
    process.exit(0);
  }
  const deps = {};
  createServer(cfg, deps).listen(cfg.port, () => {
    console.log(`STYX B2B: http://localhost:${cfg.port}  (база: ${cfg.dbPath})`);
    if (!cfg.token) console.warn("DADATA_TOKEN не задан: поиск организаций будет работать на тестовых данных.");
    if (!cfg.secret) console.warn("DADATA_SECRET не задан: проверка (стандартизация) адреса будет недоступна.");
    if (!cfg.mail.to || (!cfg.mail.smtpUrl && !cfg.mail.host && !cfg.mail.outboxDir)) {
      console.warn("Почта не настроена (ORDER_MAIL_TO и SMTP_HOST или SMTP_URL): заказы сохранятся, но письма не уйдут.");
    }
    if (!deps.db.countManagers()) console.warn('Нет ни одного менеджера: создайте его командой node server.js create-manager <email> "<имя>".');
  });
  // Раз в сутки: резервная копия базы и чистка просроченных сессий.
  const daily = () => {
    try {
      deps.db.purgeExpired();
      console.log(`Резервная копия: ${backupDatabase(deps.db, cfg)}`);
    } catch (error) {
      console.error("Backup failed:", error.message);
    }
  };
  setTimeout(daily, 60 * 1000).unref();
  setInterval(daily, 24 * 60 * 60 * 1000).unref();
}
