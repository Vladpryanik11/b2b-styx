// API кабинета: вход и регистрация, профиль, заказы клиента и кабинет менеджера.
// Сессия — HttpOnly cookie; пароли — scrypt; все данные — в SQLite (server/db.js).
const { hashPassword, verifyPassword, newToken, tokenHash, passwordProblem, parseCookies, sessionCookie, createRateLimiter } = require("./auth");
const { normalizeProfile, normalizeCompany, text } = require("./profile");
const { normalizeOrder, splitOrder, buildOrderBlanks, managerMessage, clientMessage, ENTITIES } = require("./orders");

const COOKIE = "styx_session";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 дней
const RESET_TTL = 60 * 60 * 1000; // ссылка сброса пароля живёт час
const MAX_JSON = 64 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ORDER_STATUSES = ["Новый", "В работе", "Отгружен", "Завершён", "Отменён"];
const NEW_ORDER_STATUS = ORDER_STATUSES[0];

const MESSAGES = {
  pending: "Заявка на кабинет ещё на проверке у менеджера STYX. Мы пришлём письмо, когда кабинет откроется.",
  blocked: "Доступ к кабинету закрыт. Свяжитесь с менеджером STYX.",
  badLogin: "Неверный email или пароль.",
  tooMany: "Слишком много попыток. Подождите 15 минут и попробуйте снова."
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = MAX_JSON) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) { reject(new HttpError(413, "Слишком большой запрос")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new HttpError(400, "Некорректный запрос")); }
    });
    req.on("error", reject);
  });
}

const formatDate = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(new Date(iso));

// Заказ в том виде, в каком его показывает кабинет клиента (app.js).
function toClientOrder(order) {
  return {
    number: order.number,
    companyId: order.companyId,
    companyName: order.companyName,
    date: formatDate(order.createdAt),
    createdAt: order.createdAt,
    delivery: order.delivery,
    address: order.address,
    comment: order.comment,
    items: (order.lines || []).map((line) => ({ sku: line.sku, qty: line.qty, name: line.productName || line.name, volume: line.volume || "", price: line.price })),
    subtotal: order.subtotal,
    ...(order.discount ? { promoCode: order.promoCode, discountPercent: order.discountPercent, discount: order.discount } : {}),
    total: order.total,
    status: order.status
  };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, status: user.status };
}

function createApi({ cfg, db, getTransport, getCatalog }) {
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
  const mailLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
  const registerLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
  const mail = cfg.mail || {};
  const appUrl = (cfg.appUrl || "").replace(/\/$/, "");

  const clientIp = (req) => (cfg.trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "") || req.socket.remoteAddress || "";
  const isSecure = (req) => cfg.cookieSecure || (cfg.trustProxy && req.headers["x-forwarded-proto"] === "https");
  const baseUrl = (req) => appUrl || `${isSecure(req) ? "https" : "http"}://${req.headers.host}`;

  async function sendMail(message) {
    const transport = getTransport();
    if (!transport) return false;
    try {
      await transport.sendMail({ from: mail.from, ...message });
      return true;
    } catch (error) {
      console.error("Mail failed:", error.message);
      return false;
    }
  }
  const notifyManagers = (message) => (mail.to ? sendMail({ to: mail.to, ...message }) : Promise.resolve(false));

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    return token ? db.sessionUser(tokenHash(token)) : null;
  }

  function requireUser(req, role) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "Войдите в кабинет");
    if (user.status !== "active") throw new HttpError(403, MESSAGES[user.status] || MESSAGES.blocked);
    if (role && user.role !== role) throw new HttpError(403, "Недостаточно прав");
    return user;
  }

  function startSession(req, user) {
    const { token, hash } = newToken();
    db.createSession(hash, user.id, SESSION_TTL);
    db.touchLogin(user.id);
    return { "Set-Cookie": sessionCookie(COOKIE, token, { maxAgeMs: SESSION_TTL, secure: isSecure(req) }) };
  }

  function sessionPayload(user) {
    if (!user) return { mode: "server", user: null };
    const payload = { mode: "server", user: publicUser(user) };
    if (user.role === "client") {
      const profile = normalizeProfile(user.profile);
      payload.account = profile;
      payload.orders = db.ordersByUser(user.id).map(toClientOrder);
    }
    return payload;
  }

  // ---------- Вход, регистрация, пароль ----------

  async function register(req, res) {
    if (!registerLimiter.hit(clientIp(req))) throw new HttpError(429, MESSAGES.tooMany);
    const body = await readJson(req);
    const name = text(body.name, 200);
    const email = text(body.email, 200).toLowerCase();
    const phone = text(body.phone, 50);
    const company = normalizeCompany(body.company);
    if (name.length < 2) throw new HttpError(400, "Укажите ваше имя.");
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, "Проверьте email.");
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    if (!company) throw new HttpError(400, "Выберите организацию из подсказок.");
    if (body.consent !== true) throw new HttpError(400, "Нужно согласие на обработку персональных данных.");
    if (db.userByEmail(email)) throw new HttpError(409, "Этот email уже зарегистрирован. Войдите в кабинет или восстановите пароль.");

    const status = cfg.requireApproval ? "pending" : "active";
    const user = db.createUser({
      email, name, phone, status,
      passwordHash: hashPassword(body.password),
      profile: { companies: [company], activeCompanyId: company.id },
      consentAt: new Date().toISOString()
    });
    notifyManagers({
      subject: `Новая регистрация: ${company.name}`,
      text: [
        `Зарегистрировался новый клиент${status === "pending" ? " — нужно подтвердить доступ" : ""}.`,
        "",
        `${company.name}, ИНН ${company.inn}${company.kpp ? `, КПП ${company.kpp}` : ""}`,
        company.address ? `Адрес: ${company.address}` : null,
        `Контакт: ${name}, ${email}${phone ? `, ${phone}` : ""}`,
        "",
        `Кабинет менеджера: ${baseUrl(req)}/admin`
      ].filter((line) => line !== null).join("\n")
    });
    if (status === "pending") return sendJson(res, 201, { status, message: "Заявка отправлена. Менеджер STYX проверит организацию и откроет кабинет — мы пришлём письмо." });
    return sendJson(res, 201, sessionPayload(user), startSession(req, user));
  }

  async function login(req, res) {
    const body = await readJson(req);
    const email = text(body.email, 200).toLowerCase();
    const key = `${clientIp(req)}|${email}`;
    if (!loginLimiter.hit(key)) throw new HttpError(429, MESSAGES.tooMany);
    const user = db.userByEmail(email);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) throw new HttpError(401, MESSAGES.badLogin);
    if (user.status !== "active") throw new HttpError(403, MESSAGES[user.status]);
    loginLimiter.reset(key);
    return sendJson(res, 200, sessionPayload(user), startSession(req, user));
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.deleteSession(tokenHash(token));
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(COOKIE, "", { maxAgeMs: 0, secure: isSecure(req) }) });
  }

  // Ответ одинаковый, есть такой email или нет, — чтобы по форме нельзя было проверять чужие адреса.
  async function forgot(req, res) {
    const body = await readJson(req);
    const email = text(body.email, 200).toLowerCase();
    if (!mailLimiter.hit(clientIp(req))) throw new HttpError(429, MESSAGES.tooMany);
    const user = EMAIL_PATTERN.test(email) ? db.userByEmail(email) : null;
    if (user && user.status !== "blocked") {
      const { token, hash } = newToken();
      db.createResetToken(hash, user.id, RESET_TTL);
      const link = `${baseUrl(req)}/${user.role === "manager" ? "admin" : ""}?reset=${token}`;
      const sent = await sendMail({
        to: user.email,
        subject: "Восстановление пароля STYX B2B",
        text: `Здравствуйте, ${user.name}!\n\nЧтобы задать новый пароль, откройте ссылку (действует 1 час):\n${link}\n\nЕсли вы не запрашивали смену пароля, просто проигнорируйте это письмо.`
      });
      if (!sent) console.warn(`Письмо для сброса пароля не отправлено (${user.email}): почта не настроена или недоступна.`);
    }
    return sendJson(res, 200, { ok: true, message: "Если такой email зарегистрирован, мы отправили на него ссылку для смены пароля." });
  }

  async function reset(req, res) {
    const body = await readJson(req);
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    const userId = db.consumeResetToken(tokenHash(text(body.token, 200)));
    if (!userId) throw new HttpError(400, "Ссылка устарела или уже использована. Запросите новую.");
    db.setPassword(userId, hashPassword(body.password));
    db.deleteUserSessions(userId); // выходим со всех устройств
    return sendJson(res, 200, { ok: true, message: "Пароль изменён. Войдите с новым паролем." });
  }

  async function changePassword(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    if (!verifyPassword(String(body.current || ""), user.passwordHash)) throw new HttpError(400, "Текущий пароль указан неверно.");
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    db.setPassword(user.id, hashPassword(body.password));
    db.deleteUserSessions(user.id);
    return sendJson(res, 200, sessionPayload(user), startSession(req, user));
  }

  // ---------- Кабинет клиента ----------

  async function saveAccount(req, res) {
    const user = requireUser(req, "client");
    const body = await readJson(req);
    const changes = {};
    if (body.user) {
      const name = text(body.user.name, 200);
      const email = text(body.user.email, 200).toLowerCase();
      const phone = text(body.user.phone, 50);
      if (name.length < 2) throw new HttpError(400, "Укажите имя.");
      if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, "Проверьте email.");
      const other = db.userByEmail(email);
      if (other && other.id !== user.id) throw new HttpError(409, "Этот email уже занят другим кабинетом.");
      Object.assign(changes, { name, email, phone });
    }
    if (body.account) {
      const profile = normalizeProfile(body.account);
      if (!profile.companies.length) throw new HttpError(400, "В кабинете должно остаться хотя бы одно юрлицо.");
      changes.profile = profile;
    }
    const updated = db.updateUser(user.id, changes);
    return sendJson(res, 200, { ok: true, user: publicUser(updated) });
  }

  async function createOrder(req, res) {
    const user = requireUser(req, "client");
    const body = await readJson(req);
    const profile = normalizeProfile(user.profile);
    const company = profile.companies.find((item) => item.id === body.companyId);
    if (!company) throw new HttpError(400, "Выберите юрлицо из своего кабинета.");
    const { order, errors } = normalizeOrder({
      ...body,
      company: { name: company.name, inn: company.inn, kpp: company.kpp, address: company.address },
      contact: { name: user.name, email: user.email, phone: user.phone }
    }, getCatalog());
    if (errors.length) throw new HttpError(400, errors.join(". "));
    const saved = db.createOrder({ userId: user.id, companyId: company.id, companyName: company.name, status: NEW_ORDER_STATUS, total: order.total, data: order });
    const mailStatus = await mailOrder(saved);
    return sendJson(res, 201, { order: toClientOrder(saved), mailStatus });
  }

  // Письмо менеджеру с бланками и подтверждение клиенту. Заказ уже в базе, поэтому ошибка почты его не теряет.
  async function mailOrder(saved) {
    const order = { ...saved, date: formatDate(saved.createdAt) };
    if (!getTransport() || !mail.to) {
      db.setMailStatus(saved.id, "off");
      return "off";
    }
    const blanks = await buildOrderBlanks(order);
    const sent = await sendMail({ to: mail.to, replyTo: order.contact.email || undefined, ...managerMessage(order, blanks) });
    db.setMailStatus(saved.id, sent ? "sent" : "failed");
    if (sent && mail.clientCopy !== false && order.contact.email) await sendMail({ to: order.contact.email, ...clientMessage(order) });
    return sent ? "sent" : "failed";
  }

  // ---------- Кабинет менеджера ----------

  function adminClients(req, res) {
    requireUser(req, "manager");
    const orders = db.listOrders();
    const clients = db.listClients().map((user) => {
      const own = orders.filter((order) => order.userId === user.id);
      return {
        ...publicUser(user),
        companies: normalizeProfile(user.profile).companies,
        createdAt: user.createdAt,
        approvedAt: user.approvedAt,
        lastLoginAt: user.lastLoginAt,
        consentAt: user.consentAt,
        ordersCount: own.length,
        ordersTotal: own.filter((order) => order.status !== "Отменён").reduce((sum, order) => sum + order.total, 0)
      };
    });
    return sendJson(res, 200, { clients });
  }

  async function adminSetClientStatus(req, res, id) {
    requireUser(req, "manager");
    const body = await readJson(req);
    if (!["active", "blocked"].includes(body.status)) throw new HttpError(400, "Неизвестный статус");
    const before = db.userById(id);
    if (!before || before.role !== "client") throw new HttpError(404, "Клиент не найден");
    const user = db.setStatus(id, body.status);
    if (before.status === "pending" && user.status === "active") {
      sendMail({
        to: user.email,
        subject: "Кабинет STYX B2B открыт",
        text: `Здравствуйте, ${user.name}!\n\nМенеджер STYX подтвердил ваш кабинет. Войдите по своему email и паролю:\n${baseUrl(req)}/\n\nСпасибо, что работаете с нами.`
      });
    }
    return sendJson(res, 200, { ok: true, client: publicUser(user) });
  }

  // Для списка менеджера: какие бланки (Санкт-Петербург / Москва) есть в заказе и на какую сумму.
  async function adminOrderRow(order) {
    const user = db.userById(order.userId);
    const parts = Array.isArray(order.lines) ? await splitOrder(order) : [];
    return {
      blanks: parts.map((part) => ({ id: part.entity.id, title: part.entity.title, total: part.total })),
      ...toClientOrder(order),
      mailStatus: order.mailStatus,
      client: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone } : null,
      company: order.company,
      updatedAt: order.updatedAt
    };
  }

  async function adminOrders(req, res) {
    requireUser(req, "manager");
    return sendJson(res, 200, { orders: await Promise.all(db.listOrders().map(adminOrderRow)), statuses: ORDER_STATUSES });
  }

  function findOrder(number) {
    const order = db.orderByNumber(number);
    if (!order) throw new HttpError(404, "Заказ не найден");
    return order;
  }

  async function adminSetOrderStatus(req, res, number) {
    requireUser(req, "manager");
    const body = await readJson(req);
    if (!ORDER_STATUSES.includes(body.status)) throw new HttpError(400, "Неизвестный статус заказа");
    const order = findOrder(number);
    db.setOrderStatus(order.id, body.status);
    return sendJson(res, 200, { order: await adminOrderRow(db.orderById(order.id)) });
  }

  async function adminBlank(req, res, number, entityId) {
    requireUser(req, "manager");
    const order = findOrder(number);
    const blanks = await buildOrderBlanks({ ...order, date: formatDate(order.createdAt) });
    const blank = blanks.find(({ part }) => part.entity.id === entityId);
    if (!blank) throw new HttpError(404, "В этом заказе нет такого бланка");
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // filename — запасное латинское имя для старых программ, filename* — настоящее русское имя бланка.
      "Content-Disposition": `attachment; filename="${order.number}-${entityId}.xlsx"; filename*=UTF-8''${encodeURIComponent(blank.filename)}`,
      "Cache-Control": "no-store"
    });
    res.end(blank.content);
  }

  async function adminResend(req, res, number) {
    requireUser(req, "manager");
    const order = findOrder(number);
    const mailStatus = await mailOrder(order);
    return sendJson(res, mailStatus === "sent" ? 200 : 502, { mailStatus, error: mailStatus === "sent" ? undefined : "Письмо не отправлено: проверьте настройки почты" });
  }

  // ---------- Маршруты ----------

  const routes = [
    ["GET", /^\/api\/session$/, (req, res) => sendJson(res, 200, sessionPayload((() => { const u = currentUser(req); return u && u.status === "active" ? u : null; })()))],
    ["POST", /^\/api\/auth\/register$/, register],
    ["POST", /^\/api\/auth\/login$/, login],
    ["POST", /^\/api\/auth\/logout$/, logout],
    ["POST", /^\/api\/auth\/forgot$/, forgot],
    ["POST", /^\/api\/auth\/reset$/, reset],
    ["POST", /^\/api\/account\/password$/, changePassword],
    ["PUT", /^\/api\/account$/, saveAccount],
    ["POST", /^\/api\/orders$/, createOrder],
    ["GET", /^\/api\/admin\/clients$/, adminClients],
    ["POST", /^\/api\/admin\/clients\/(\d+)\/status$/, (req, res, id) => adminSetClientStatus(req, res, Number(id))],
    ["GET", /^\/api\/admin\/orders$/, adminOrders],
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/status$/, adminSetOrderStatus],
    ["GET", /^\/api\/admin\/orders\/([\w-]+)\/blank\/(\w+)$/, adminBlank],
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/resend$/, adminResend]
  ];

  // Защита от подделки запросов с чужих сайтов: изменяющие запросы — только JSON и только со своего адреса.
  function checkOrigin(req) {
    if (req.method === "GET") return;
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "Ожидается JSON");
    const origin = req.headers.origin;
    if (!origin || origin === baseUrl(req)) return;
    let host = "";
    try { host = new URL(origin).host; } catch {}
    if (host !== req.headers.host) throw new HttpError(403, "Запрос с чужого сайта");
  }

  return async function handle(req, res, url) {
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) return false;
    try {
      checkOrigin(req);
      await route[2](req, res, ...url.pathname.match(route[1]).slice(1));
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      sendJson(res, error.status, { error: error.message });
    }
    return true;
  };
}

module.exports = { createApi, ORDER_STATUSES, ENTITIES };
