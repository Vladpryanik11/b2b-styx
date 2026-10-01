// Пароли, сессии и защита от подбора. Только встроенный crypto, без зависимостей.
const crypto = require("node:crypto");

// scrypt: N=2^15 — ~50–100 мс на проверку, подбор по украденной базе дорогой.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(actual, expected);
}

// Токен уходит клиенту (cookie или ссылка в письме), в базе лежит только его SHA-256.
function newToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

const tokenHash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const PASSWORD_MIN = 8;
function passwordProblem(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Пароль должен быть не короче ${PASSWORD_MIN} символов.`;
  if (password.length > 200) return "Слишком длинный пароль.";
  return "";
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([key]) => key).map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))]));
}

function sessionCookie(name, value, { maxAgeMs, secure }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    maxAgeMs === 0 ? "Max-Age=0" : `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ].filter(Boolean).join("; ");
}

/** Счётчик попыток в памяти: не больше limit событий за windowMs на ключ (IP, IP+email). */
function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    hit(key) {
      const nowMs = Date.now();
      const list = (hits.get(key) || []).filter((time) => nowMs - time < windowMs);
      list.push(nowMs);
      hits.set(key, list);
      if (hits.size > 10000) for (const [k, v] of hits) if (!v.some((time) => nowMs - time < windowMs)) hits.delete(k);
      return list.length <= limit;
    },
    reset: (key) => hits.delete(key)
  };
}

module.exports = { hashPassword, verifyPassword, newToken, tokenHash, passwordProblem, parseCookies, sessionCookie, createRateLimiter, PASSWORD_MIN };
