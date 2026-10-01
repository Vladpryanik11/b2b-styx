// API кабинета: вход и регистрация, профиль, заказы клиента и кабинет менеджера.
// Сессия — HttpOnly cookie; пароли — scrypt; все данные — в SQLite (server/db.js).
const { hashPasswordAsync, verifyPasswordAsync, DUMMY_HASH, newToken, tokenHash, passwordProblem, parseCookies, sessionCookie, createRateLimiter } = require("./auth");
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

// Тело собирается из байтов целиком и только потом декодируется: русская буква на стыке двух пакетов не портится.
// Принимается только JSON-объект; null, массив или строка — ошибка 400, а не падение обработчика.
function readJson(req, limit = MAX_JSON) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > limit) return reject(new HttpError(413, "Слишком большой запрос"));
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try { parsed = body ? JSON.parse(body) : {}; } catch { return reject(new HttpError(400, "Некорректный запрос")); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(new HttpError(400, "Некорректный запрос"));
      resolve(parsed);
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
  // Перебор одного пароля по многим email с одного адреса: каждая попытка ещё и тратит ~32 МБ на scrypt.
  const loginIpLimiter = createRateLimiter({ limit: 50, windowMs: 15 * 60 * 1000 });
  const mailLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
  // Офис за одним NAT: 5 писем в час — на каждый email, и общий потолок на адрес.
  const mailIpLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });
  const registerLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
  const mail = cfg.mail || {};
  const appUrl = (cfg.appUrl || "").replace(/\/$/, "");

  // За прокси адрес клиента — последний в X-Forwarded-For: его дописывает сам прокси, а начало списка клиент может подделать.
  const clientIp = (req) => (cfg.trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",").pop().trim() : "") || req.socket.remoteAddress || "";
  // За цепочкой прокси заголовок может быть списком «https, http»: протокол клиента — первый.
  const isSecure = (req) => cfg.cookieSecure || (cfg.trustProxy && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
  const baseUrl = (req) => appUrl || `${isSecure(req) ? "https" : "http"}://${req.headers.host}`;
  // Ссылки в письмах строятся только от APP_URL: заголовок Host присылает браузер, и подделанный Host
  // увёл бы ссылку сброса пароля на чужой сайт. Без APP_URL ссылка ведёт на localhost (для локальной проверки).
  const linkBase = () => appUrl || `http://localhost:${cfg.port || 8080}`;

  // Неверные настройки почты (например, испорченный SMTP_URL) не роняют сервер: письмо просто считается неотправленным.
  function transport() {
    try {
      return getTransport();
    } catch (error) {
      console.error("Mail transport misconfigured:", error.message);
      return null;
    }
  }

  async function sendMail(message) {
    const mailer = transport();
    if (!mailer) return false;
    try {
      await mailer.sendMail({ from: mail.from, ...message });
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
    const passwordHash = await hashPasswordAsync(body.password);
    if (db.userByEmail(email)) throw new HttpError(409, "Этот email уже зарегистрирован. Войдите в кабинет или восстановите пароль.");

    const status = cfg.requireApproval ? "pending" : "active";
    const user = db.createUser({
      email, name, phone, status,
      passwordHash,
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
        `Кабинет менеджера: ${linkBase()}/admin`
      ].filter((line) => line !== null).join("\n")
    });
    if (status === "pending") return sendJson(res, 201, { status, message: "Заявка отправлена. Менеджер STYX проверит организацию и откроет кабинет — мы пришлём письмо." });
    return sendJson(res, 201, sessionPayload(user), startSession(req, user));
  }

  async function login(req, res) {
    const body = await readJson(req);
    const email = text(body.email, 200).toLowerCase();
    const key = `${clientIp(req)}|${email}`;
    if (!loginIpLimiter.hit(clientIp(req)) || !loginLimiter.hit(key)) throw new HttpError(429, MESSAGES.tooMany);
    const user = db.userByEmail(email);
    const valid = await verifyPasswordAsync(String(body.password || ""), user ? user.passwordHash : DUMMY_HASH);
    if (!user || !valid) throw new HttpError(401, MESSAGES.badLogin);
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
    if (!mailIpLimiter.hit(clientIp(req)) || !mailLimiter.hit(`${clientIp(req)}|${email}`)) throw new HttpError(429, MESSAGES.tooMany);
    const user = EMAIL_PATTERN.test(email) ? db.userByEmail(email) : null;
    if (user && user.status !== "blocked") {
      const { token, hash } = newToken();
      db.createResetToken(hash, user.id, RESET_TTL);
      const link = `${linkBase()}/${user.role === "manager" ? "admin" : ""}?reset=${token}`;
      // Письмо отправляется без ожидания: иначе по времени ответа было бы видно, что такой email есть.
      sendMail({
        to: user.email,
        subject: "Восстановление пароля STYX B2B",
        text: `Здравствуйте, ${user.name}!\n\nЧтобы задать новый пароль, откройте ссылку (действует 1 час):\n${link}\n\nЕсли вы не запрашивали смену пароля, просто проигнорируйте это письмо.`
      }).then((sent) => { if (!sent) console.warn(`Письмо для сброса пароля не отправлено (${user.email}): почта не настроена или недоступна.`); });
    }
    return sendJson(res, 200, { ok: true, message: "Если такой email зарегистрирован, мы отправили на него ссылку для смены пароля." });
  }

  async function reset(req, res) {
    const body = await readJson(req);
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    const userId = db.consumeResetToken(tokenHash(text(body.token, 200)));
    if (!userId) throw new HttpError(400, "Ссылка устарела или уже использована. Запросите новую.");
    db.setPassword(userId, await hashPasswordAsync(body.password));
    db.deleteUserSessions(userId); // выходим со всех устройств
    return sendJson(res, 200, { ok: true, message: "Пароль изменён. Войдите с новым паролем." });
  }

  async function changePassword(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    if (!(await verifyPasswordAsync(String(body.current || ""), user.passwordHash))) throw new HttpError(400, "Текущий пароль указан неверно.");
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    db.setPassword(user.id, await hashPasswordAsync(body.password));
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
      // Email — это логин и адрес для сброса пароля: без пароля его сменил бы любой, у кого открыт кабинет.
      if (email !== user.email) {
        if (!body.user.current) throw new HttpError(400, "Для смены email укажите текущий пароль.");
        if (!(await verifyPasswordAsync(String(body.user.current), user.passwordHash))) throw new HttpError(400, "Текущий пароль указан неверно.");
        sendMail({
          to: user.email,
          subject: "Email в кабинете STYX B2B изменён",
          text: `Здравствуйте, ${user.name}!\n\nEmail для входа в кабинет STYX B2B изменён на ${email}. Если это сделали не вы, ответьте на это письмо или свяжитесь с менеджером STYX.`
        });
      }
      Object.assign(changes, { name, email, phone });
    }
    let addedCompanies = [];
    if (body.account) {
      const profile = normalizeProfile(body.account);
      if (!profile.companies.length) throw new HttpError(400, "В кабинете должно остаться хотя бы одно юрлицо.");
      // Реквизиты уже сохранённого юрлица из браузера не меняются: ИНН и КПП проверял менеджер.
      const known = new Map(normalizeProfile(user.profile).companies.map((company) => [company.id, company]));
      profile.companies.forEach((company) => {
        const before = known.get(company.id);
        if (before && (before.inn !== company.inn || before.kpp !== company.kpp)) throw new HttpError(400, "Реквизиты юрлица изменить нельзя. Удалите его и добавьте заново по ИНН.");
      });
      const knownInns = new Set([...known.values()].map((company) => company.inn));
      addedCompanies = profile.companies.filter((company) => !known.has(company.id) && !knownInns.has(company.inn));
      changes.profile = profile;
    }
    const updated = db.updateUser(user.id, changes);
    // Новое юрлицо в кабинете — сообщаем менеджеру, чтобы он видел, на кого клиент будет заказывать.
    if (addedCompanies.length) {
      notifyManagers({
        subject: `Клиент добавил юрлицо: ${addedCompanies.map((company) => company.name).join(", ")}`,
        text: [
          `${updated.name} (${updated.email}) добавил в кабинет:`,
          "",
          ...addedCompanies.map((company) => `${company.name}, ИНН ${company.inn}${company.kpp ? `, КПП ${company.kpp}` : ""}${company.address ? `\n${company.address}` : ""}`),
          "",
          `Кабинет менеджера: ${linkBase()}/admin`
        ].join("\n")
      });
    }
    return sendJson(res, 200, { ok: true, user: publicUser(updated) });
  }

  async function createOrder(req, res) {
    const user = requireUser(req, "client");
    const body = await readJson(req);
    const profile = normalizeProfile(user.profile);
    const company = profile.companies.find((item) => item.id === body.companyId);
    if (!company) throw new HttpError(400, "Выберите юрлицо из своего кабинета.");
    // Номер и дату назначает база: из запроса берём только то, что выбирает клиент.
    const { order, errors } = normalizeOrder({
      delivery: body.delivery,
      address: body.address,
      comment: body.comment,
      items: body.items,
      promoCode: body.promoCode,
      company: { name: company.name, inn: company.inn, kpp: company.kpp, address: company.address },
      contact: { name: user.name, email: user.email, phone: user.phone }
    }, getCatalog());
    if (errors.length) throw new HttpError(400, errors.join(". "));
    const saved = db.createOrder({ userId: user.id, companyId: company.id, companyName: company.name, status: NEW_ORDER_STATUS, total: order.total, data: order });
    // Заказ уже в базе: любая ошибка при письме не должна выглядеть для клиента как «не принят», иначе он оформит его повторно.
    let mailStatus = "failed";
    try {
      mailStatus = await mailOrder(saved);
    } catch (error) {
      console.error(`Письмо по заказу ${saved.number} не отправлено:`, error);
      db.setMailStatus(saved.id, "failed");
    }
    return sendJson(res, 201, { order: toClientOrder(saved), mailStatus });
  }

  // Письмо менеджеру с бланками и подтверждение клиенту. Заказ уже в базе, поэтому ошибка почты его не теряет.
  // При повторной отправке менеджером клиенту второе подтверждение не уходит, а статус «ушло» не сбрасывается.
  async function mailOrder(saved, { resend = false } = {}) {
    const order = { ...saved, date: formatDate(saved.createdAt) };
    if (!transport() || !mail.to) {
      if (saved.mailStatus !== "sent") db.setMailStatus(saved.id, "off");
      return "off";
    }
    const blanks = await buildOrderBlanks(order);
    const sent = await sendMail({ to: mail.to, replyTo: order.contact.email || undefined, ...managerMessage(order, blanks) });
    if (sent || saved.mailStatus !== "sent") db.setMailStatus(saved.id, sent ? "sent" : "failed");
    if (sent && !resend && mail.clientCopy !== false && order.contact.email) await sendMail({ to: order.contact.email, ...clientMessage(order) });
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
    // Два менеджера или две вкладки: решение, принятое по устаревшему списку, не отменяет чужое.
    if (body.from && body.from !== before.status) throw new HttpError(409, "Статус клиента уже изменил другой менеджер. Список обновлён.");
    const user = db.setStatus(id, body.status);
    // Письмо «кабинет открыт» — при первом допуске, в том числе если заявку сначала отклонили, а потом приняли.
    if (!before.approvedAt && before.status !== "active" && user.status === "active") {
      sendMail({
        to: user.email,
        subject: "Кабинет STYX B2B открыт",
        text: `Здравствуйте, ${user.name}!\n\nМенеджер STYX подтвердил ваш кабинет. Войдите по своему email и паролю:\n${linkBase()}/\n\nСпасибо, что работаете с нами.`
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
    const mailStatus = await mailOrder(order, { resend: true });
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

  async function handle(req, res, url) {
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
  }

  // Для прокси поиска организаций в server.js: кто вошёл, адрес клиента и проверка источника запроса.
  handle.currentUser = currentUser;
  handle.clientIp = clientIp;
  handle.checkOrigin = checkOrigin;
  handle.HttpError = HttpError;
  return handle;
}

module.exports = { createApi, ORDER_STATUSES, ENTITIES };
