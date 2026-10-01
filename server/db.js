// Хранилище кабинета: SQLite (встроенный node:sqlite, Node.js 22.13+). Один файл базы, путь — DB_PATH.
// Клиенты, их юрлица и адреса (profile — JSON, как в кабинете), сессии, ссылки сброса пароля и заказы.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'manager')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked')),
  profile TEXT NOT NULL DEFAULT '{}',
  consent_at TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  status TEXT NOT NULL,
  mail_status TEXT NOT NULL DEFAULT 'pending',
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;

const now = () => new Date().toISOString();
const parse = (json, fallback) => { try { return JSON.parse(json); } catch { return fallback; } };

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: row.role,
    status: row.status,
    profile: parse(row.profile, {}),
    passwordHash: row.password_hash,
    consentAt: row.consent_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    lastLoginAt: row.last_login_at
  };
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    ...parse(row.data, {}),
    id: row.id,
    number: row.number,
    userId: row.user_id,
    companyId: row.company_id,
    companyName: row.company_name,
    status: row.status,
    mailStatus: row.mail_status,
    total: row.total,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function openDb(file = ":memory:") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  return {
    raw: db,
    close: () => db.close(),

    // ---------- Пользователи ----------
    createUser({ email, name, phone = "", passwordHash, role = "client", status = "pending", profile = {}, consentAt = null }) {
      const { lastInsertRowid } = run(
        "INSERT INTO users (email, name, phone, password_hash, role, status, profile, consent_at, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        email, name, phone, passwordHash, role, status, JSON.stringify(profile), consentAt, now(), status === "active" ? now() : null
      );
      return this.userById(Number(lastInsertRowid));
    },
    userById: (id) => rowToUser(one("SELECT * FROM users WHERE id = ?", id)),
    userByEmail: (email) => rowToUser(one("SELECT * FROM users WHERE email = ?", email)),
    updateUser(id, { name, phone, email, profile }) {
      const user = this.userById(id);
      // Ссылка сброса, отправленная на прежний адрес, после смены email не работает.
      if (email && email !== user.email) run("DELETE FROM reset_tokens WHERE user_id = ?", id);
      run("UPDATE users SET name = ?, phone = ?, email = ?, profile = ? WHERE id = ?",
        name ?? user.name, phone ?? user.phone, email ?? user.email, JSON.stringify(profile ?? user.profile), id);
      return this.userById(id);
    },
    setPassword(id, passwordHash) {
      run("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, id);
      run("DELETE FROM reset_tokens WHERE user_id = ?", id); // старые ссылки сброса больше не действуют
    },
    setStatus(id, status) {
      run("UPDATE users SET status = ?, approved_at = COALESCE(approved_at, CASE WHEN ? = 'active' THEN ? END) WHERE id = ?", status, status, now(), id);
      if (status === "blocked") {
        run("DELETE FROM sessions WHERE user_id = ?", id);
        run("DELETE FROM reset_tokens WHERE user_id = ?", id);
      }
      return this.userById(id);
    },
    touchLogin: (id) => run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), id),
    listClients: () => all("SELECT * FROM users WHERE role = 'client' ORDER BY created_at DESC").map(rowToUser),
    countManagers: () => one("SELECT COUNT(*) AS n FROM users WHERE role = 'manager'").n,

    // ---------- Сессии ----------
    createSession(tokenHash, userId, ttlMs) {
      run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", tokenHash, userId, now(), new Date(Date.now() + ttlMs).toISOString());
    },
    sessionUser(tokenHash) {
      const row = one("SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?", tokenHash, now());
      return rowToUser(row);
    },
    deleteSession: (tokenHash) => run("DELETE FROM sessions WHERE token_hash = ?", tokenHash),
    deleteUserSessions: (userId) => run("DELETE FROM sessions WHERE user_id = ?", userId),
    purgeExpired() {
      run("DELETE FROM sessions WHERE expires_at <= ?", now());
      run("DELETE FROM reset_tokens WHERE expires_at <= ?", now());
    },

    // ---------- Сброс пароля ----------
    createResetToken(tokenHash, userId, ttlMs) {
      run("DELETE FROM reset_tokens WHERE user_id = ?", userId);
      run("INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)", tokenHash, userId, new Date(Date.now() + ttlMs).toISOString());
    },
    // Ссылка одноразовая: при успехе помечается использованной.
    consumeResetToken(tokenHash) {
      const row = one("SELECT * FROM reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", tokenHash, now());
      if (!row) return null;
      run("UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?", now(), tokenHash);
      return row.user_id;
    },

    // ---------- Заказы ----------
    // Номер заказа сквозной: STYX-00001, STYX-00002… по порядку в базе.
    createOrder({ userId, companyId, companyName, status, total, data }) {
      const created = now();
      const { lastInsertRowid } = run(
        "INSERT INTO orders (user_id, company_id, company_name, status, total, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        userId, companyId, companyName, status, total, created, created, JSON.stringify(data)
      );
      const id = Number(lastInsertRowid);
      run("UPDATE orders SET number = ? WHERE id = ?", `STYX-${String(id).padStart(5, "0")}`, id);
      return this.orderById(id);
    },
    orderById: (id) => rowToOrder(one("SELECT * FROM orders WHERE id = ?", id)),
    orderByNumber: (number) => rowToOrder(one("SELECT * FROM orders WHERE number = ?", number)),
    ordersByUser: (userId) => all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", userId).map(rowToOrder),
    listOrders: () => all("SELECT * FROM orders ORDER BY id DESC").map(rowToOrder),
    setOrderStatus: (id, status) => run("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", status, now(), id),
    setMailStatus: (id, mailStatus) => run("UPDATE orders SET mail_status = ?, updated_at = ? WHERE id = ?", mailStatus, now(), id),

    // ---------- Резервная копия ----------
    // Копия пишется во временный файл и только потом заменяет прежнюю: сбой не оставит день без копии.
    backupTo(file) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      const temp = `${file}.tmp`;
      if (fs.existsSync(temp)) fs.rmSync(temp);
      db.exec(`VACUUM INTO '${String(temp).replace(/'/g, "''")}'`);
      fs.renameSync(temp, file);
    }
  };
}

module.exports = { openDb };
