// Тесты API кабинета: регистрация с подтверждением менеджером, вход, сессии, профиль, заказы,
// сброс пароля и кабинет менеджера. База — SQLite в памяти, почта — тестовый транспорт, который только запоминает письма.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { createServer } = require("../server.js");
const { openDb } = require("../server/db");
const { hashPassword } = require("../server/auth");

const MAIL = { to: "orders@styx.test", from: "cabinet@styx.test", clientCopy: true };
const COMPANY = { id: "company-7701234567", name: "ООО «Северный Стикс»", inn: "7701234567", kpp: "770101001", address: "г. Москва, ул. Правды, д. 8", deliveryAddresses: [] };

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function withApp(run, cfg = {}) {
  const sent = [];
  const db = openDb(":memory:");
  db.createUser({ email: "manager@styx.test", name: "Мария", passwordHash: hashPassword("manager-pass"), role: "manager", status: "active" });
  const transport = { async sendMail(message) { sent.push(message); return { messageId: "test" }; } };
  const { brokenTransport, ...rest } = cfg;
  const app = createServer({ token: "", secret: "", mail: MAIL, requireApproval: true, ...rest }, { db, transport, getTransport: brokenTransport?.getTransport });
  const base = await listen(app);
  try { await run(client(base), { sent, db, base }); } finally { app.close(); }
}

// Мини-браузер: хранит cookie сессии между запросами.
function client(base) {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0].endsWith("=") ? "" : setCookie.split(";")[0];
    const type = response.headers.get("content-type") || "";
    return { status: response.status, headers: response.headers, body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()), setCookie };
  };
  return { call, fork: () => client(base), get cookie() { return cookie; } };
}

const REGISTER = { name: "Анна Петрова", email: "anna@example.ru", phone: "+7 900 000-00-00", password: "strong-pass-1", company: COMPANY, consent: true };

async function registerAndApprove(browser, ctx) {
  assert.equal((await browser.call("POST", "/api/auth/register", REGISTER)).status, 201);
  const manager = browser.fork();
  assert.equal((await manager.call("POST", "/api/auth/login", { email: "manager@styx.test", password: "manager-pass" })).status, 200);
  const { body } = await manager.call("GET", "/api/admin/clients");
  const id = body.clients.find((item) => item.email === REGISTER.email).id;
  assert.equal((await manager.call("POST", `/api/admin/clients/${id}/status`, { status: "active" })).status, 200);
  const login = await browser.call("POST", "/api/auth/login", { email: REGISTER.email, password: REGISTER.password });
  assert.equal(login.status, 200);
  return { manager, clientId: id, session: login.body };
}

test("без входа /api/session отвечает, что сервер есть, а пользователя нет", async () => {
  await withApp(async (browser) => {
    const { status, body } = await browser.call("GET", "/api/session");
    assert.equal(status, 200);
    assert.deepEqual(body, { mode: "server", user: null });
  });
});

test("регистрация ждёт подтверждения менеджера: до него войти нельзя, менеджеру приходит письмо", async () => {
  await withApp(async (browser, { sent, db }) => {
    const reg = await browser.call("POST", "/api/auth/register", REGISTER);
    assert.equal(reg.status, 201);
    assert.equal(reg.body.status, "pending");
    assert.equal(reg.setCookie, null, "до подтверждения сессии нет");
    const login = await browser.call("POST", "/api/auth/login", { email: REGISTER.email, password: REGISTER.password });
    assert.equal(login.status, 403);
    assert.match(login.body.error, /на проверке/);
    assert.match(sent[0].subject, /Новая регистрация: ООО «Северный Стикс»/);
    const user = db.userByEmail(REGISTER.email);
    assert.match(user.passwordHash, /^scrypt\$/, "пароль хранится только как хеш");
    assert.ok(!JSON.stringify(user).includes(REGISTER.password));
    assert.ok(user.consentAt, "согласие на обработку данных сохранено");
  });
});

test("регистрация проверяет согласие, пароль, организацию и повторный email", async () => {
  await withApp(async (browser) => {
    assert.equal((await browser.call("POST", "/api/auth/register", { ...REGISTER, consent: false })).status, 400);
    assert.equal((await browser.call("POST", "/api/auth/register", { ...REGISTER, password: "123" })).status, 400);
    assert.equal((await browser.call("POST", "/api/auth/register", { ...REGISTER, company: { inn: "12" } })).status, 400);
    assert.equal((await browser.call("POST", "/api/auth/register", REGISTER)).status, 201);
    assert.equal((await browser.call("POST", "/api/auth/register", REGISTER)).status, 409);
  });
});

test("после подтверждения клиент входит, получает профиль и письмо об открытии кабинета", async () => {
  await withApp(async (browser, { sent }) => {
    const { session } = await registerAndApprove(browser);
    assert.equal(session.user.email, REGISTER.email);
    assert.equal(session.account.companies[0].inn, "7701234567");
    assert.deepEqual(session.orders, []);
    assert.ok(sent.some((mail) => mail.to === REGISTER.email && /Кабинет STYX B2B открыт/.test(mail.subject)));
    const cookie = browser.cookie;
    assert.ok(cookie.startsWith("styx_session="));
    const me = await browser.call("GET", "/api/session");
    assert.equal(me.body.user.name, "Анна Петрова");
  });
});

test("cookie сессии HttpOnly и SameSite, выход закрывает сессию", async () => {
  await withApp(async (browser) => {
    await browser.call("POST", "/api/auth/register", REGISTER);
    const { manager } = await registerAndApprove(browser.fork()).catch(() => ({}));
    void manager;
  });
  await withApp(async (browser) => {
    const { session } = await registerAndApprove(browser);
    void session;
    const again = await browser.call("POST", "/api/auth/login", { email: REGISTER.email, password: REGISTER.password });
    assert.match(again.setCookie, /HttpOnly/);
    assert.match(again.setCookie, /SameSite=Lax/);
    await browser.call("POST", "/api/auth/logout", {});
    assert.equal((await browser.call("GET", "/api/session")).body.user, null);
  });
});

test("неверный пароль не пускает, а после 10 попыток вход временно блокируется", async () => {
  await withApp(async (browser) => {
    await registerAndApprove(browser);
    const outsider = browser.fork();
    for (let i = 0; i < 10; i += 1) assert.equal((await outsider.call("POST", "/api/auth/login", { email: REGISTER.email, password: "wrong" })).status, 401);
    assert.equal((await outsider.call("POST", "/api/auth/login", { email: REGISTER.email, password: REGISTER.password })).status, 429);
  });
});

test("профиль: юрлица и адреса сохраняются на сервере, чужой email занять нельзя", async () => {
  await withApp(async (browser) => {
    await registerAndApprove(browser);
    const second = { id: "company-770412345678", name: "ИП Петрова", inn: "770412345678", deliveryAddresses: [{ id: "a1", label: "Склад", address: "г. Москва, ул. Лесная, д. 5", isDefault: true }] };
    const saved = await browser.call("PUT", "/api/account", { user: { name: "Анна П.", email: REGISTER.email, phone: "" }, account: { companies: [COMPANY, second], activeCompanyId: "all" } });
    assert.equal(saved.status, 200);
    const me = await browser.call("GET", "/api/session");
    assert.equal(me.body.user.name, "Анна П.");
    assert.equal(me.body.account.companies.length, 2);
    assert.equal(me.body.account.activeCompanyId, "all");
    assert.equal(me.body.account.companies[1].deliveryAddresses[0].address, "г. Москва, ул. Лесная, д. 5");
    assert.equal((await browser.call("PUT", "/api/account", { user: { name: "Анна", email: "manager@styx.test" } })).status, 409);
    assert.equal((await browser.call("PUT", "/api/account", { account: { companies: [] } })).status, 400);
  });
});

test("заказ сохраняется на сервере со сквозным номером, уходит письмом с бланками и виден в кабинете", async () => {
  await withApp(async (browser, { sent }) => {
    await registerAndApprove(browser);
    const created = await browser.call("POST", "/api/orders", {
      companyId: COMPANY.id, delivery: "Доставка", address: "г. Москва, ул. Лесная, д. 5", comment: "Позвонить",
      items: [{ sku: "82014", qty: 2 }, { sku: "81016", qty: 1 }], promoCode: "XSIZE"
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.order.number, "STYX-00001");
    assert.equal(created.body.order.status, "Новый");
    assert.equal(created.body.order.companyName, "ООО «Северный Стикс»");
    assert.equal(created.body.mailStatus, "sent");
    assert.equal(created.body.order.total, (3172 * 2 + 14152) - Math.round((3172 * 2 + 14152) * 0.1));
    assert.deepEqual(created.body.order.items[0], { sku: "82014", qty: 2, name: "Лосьон «Лед»", volume: "200 мл", price: 3172 });
    const managerMail = sent.find((mail) => mail.to === MAIL.to && /Заказ STYX-00001/.test(mail.subject));
    assert.equal(managerMail.attachments.length, 2);
    assert.match(managerMail.text, /ИНН 7701234567, КПП 770101001/);
    const me = await browser.call("GET", "/api/session");
    assert.equal(me.body.orders[0].number, "STYX-00001");
    const second = await browser.call("POST", "/api/orders", { companyId: COMPANY.id, delivery: "Самовывоз", items: [{ sku: "15000", qty: 1 }] });
    assert.equal(second.body.order.number, "STYX-00002");
  });
});

test("заказ нельзя оформить на чужое юрлицо или без входа", async () => {
  await withApp(async (browser) => {
    assert.equal((await browser.call("POST", "/api/orders", { companyId: COMPANY.id, delivery: "Самовывоз", items: [{ sku: "15000", qty: 1 }] })).status, 401);
    await registerAndApprove(browser);
    assert.equal((await browser.call("POST", "/api/orders", { companyId: "company-0000000000", delivery: "Самовывоз", items: [{ sku: "15000", qty: 1 }] })).status, 400);
  });
});

test("если почта не настроена, заказ всё равно сохраняется", async () => {
  await withApp(async (browser, { db }) => {
    await registerAndApprove(browser);
    const created = await browser.call("POST", "/api/orders", { companyId: COMPANY.id, delivery: "Самовывоз", items: [{ sku: "15000", qty: 1 }] });
    assert.equal(created.status, 201);
    assert.equal(created.body.mailStatus, "off");
    assert.equal(db.listOrders().length, 1);
  }, { mail: {} });
});

test("сброс пароля: одноразовая ссылка по email, старые сессии закрываются", async () => {
  await withApp(async (browser, { sent }) => {
    await registerAndApprove(browser);
    const forgot = await browser.fork().call("POST", "/api/auth/forgot", { email: REGISTER.email });
    assert.equal(forgot.status, 200);
    const unknown = await browser.fork().call("POST", "/api/auth/forgot", { email: "nobody@example.ru" });
    assert.equal(unknown.body.message, forgot.body.message, "ответ не выдаёт, есть ли такой email");
    const letter = sent.find((mail) => /Восстановление пароля/.test(mail.subject));
    const token = letter.text.match(/\?reset=([\w-]+)/)[1];
    assert.equal((await browser.fork().call("POST", "/api/auth/reset", { token, password: "new-strong-pass" })).status, 200);
    assert.equal((await browser.fork().call("POST", "/api/auth/reset", { token, password: "another-pass" })).status, 400, "ссылка одноразовая");
    assert.equal((await browser.call("GET", "/api/session")).body.user, null, "старая сессия закрыта");
    assert.equal((await browser.call("POST", "/api/auth/login", { email: REGISTER.email, password: "new-strong-pass" })).status, 200);
  });
});

test("кабинет менеджера: клиенты, статусы заказов, бланки и блокировка", async () => {
  await withApp(async (browser, { sent }) => {
    const { manager, clientId } = await registerAndApprove(browser);
    await browser.call("POST", "/api/orders", { companyId: COMPANY.id, delivery: "Самовывоз", items: [{ sku: "82019", qty: 1 }, { sku: "15000", qty: 3 }] });

    assert.equal((await browser.call("GET", "/api/admin/orders")).status, 403, "клиенту кабинет менеджера закрыт");
    const orders = await manager.call("GET", "/api/admin/orders");
    assert.equal(orders.body.orders[0].client.email, REGISTER.email);
    assert.deepEqual(orders.body.statuses, ["Новый", "В работе", "Отгружен", "Завершён", "Отменён"]);
    assert.deepEqual(orders.body.orders[0].blanks.map((blank) => blank.id), ["spb", "msk"], "менеджер видит, какие бланки есть в заказе");

    assert.equal((await manager.call("POST", "/api/admin/orders/STYX-00001/status", { status: "В работе" })).status, 200);
    assert.equal((await browser.call("GET", "/api/session")).body.orders[0].status, "В работе", "клиент видит новый статус");
    assert.equal((await manager.call("POST", "/api/admin/orders/STYX-00001/status", { status: "Потерян" })).status, 400);

    const blank = await manager.call("GET", "/api/admin/orders/STYX-00001/blank/spb");
    assert.equal(blank.status, 200);
    assert.match(blank.headers.get("content-disposition"), /attachment/);
    const zip = await JSZip.loadAsync(blank.body);
    assert.match(await zip.file("xl/worksheets/sheet1.xml").async("string"), /<c r="E9" s="\d+" t="n"><v>1<\/v><\/c>/);
    assert.equal((await manager.call("GET", "/api/admin/orders/STYX-00001/blank/xxx")).status, 404);

    const before = sent.length;
    assert.equal((await manager.call("POST", "/api/admin/orders/STYX-00001/resend", {})).status, 200);
    assert.equal(sent.length, before + 1, "повторно уходит только письмо менеджеру, клиенту второе подтверждение не шлём");
    assert.equal(sent.at(-1).to, MAIL.to);

    const clients = await manager.call("GET", "/api/admin/clients");
    assert.equal(clients.body.clients[0].ordersCount, 1);
    assert.equal((await manager.call("POST", `/api/admin/clients/${clientId}/status`, { status: "blocked" })).status, 200);
    assert.equal((await browser.call("GET", "/api/session")).body.user, null, "заблокированный клиент выходит сразу");
    assert.equal((await browser.call("POST", "/api/auth/login", { email: REGISTER.email, password: REGISTER.password })).status, 403);
  });
});

test("изменяющие запросы с чужого сайта и не-JSON отклоняются", async () => {
  await withApp(async (browser, { base }) => {
    const foreign = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
    const opaque = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "null" }, body: "{}" });
    assert.equal(opaque.status, 403);
    assert.equal(foreign.status, 403);
    const form = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=a" });
    assert.equal(form.status, 415);
  });
});

test("без обязательного подтверждения (REQUIRE_APPROVAL=0) клиент входит сразу после регистрации", async () => {
  await withApp(async (browser) => {
    const reg = await browser.call("POST", "/api/auth/register", REGISTER);
    assert.equal(reg.status, 201);
    assert.equal(reg.body.user.email, REGISTER.email);
    assert.ok(browser.cookie);
  }, { requireApproval: false });
});

test("страницы кабинета менеджера и политики конфиденциальности отдаются", async () => {
  await withApp(async (browser, { base }) => {
    for (const path of ["/admin", "/admin.js", "/privacy"]) assert.equal((await fetch(`${base}${path}`)).status, 200, path);
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal((await fetch(`${base}/data/styx.sqlite`)).status, 404);
  });
});

test("ссылка сброса пароля строится от APP_URL, а не от присланного заголовка Host", async () => {
  await withApp(async (browser, { sent, base }) => {
    await registerAndApprove(browser);
    const { port } = new URL(base);
    // fetch не даёт подменить Host, поэтому запрос отправляем напрямую через http.
    await new Promise((resolve, reject) => {
      const req = require("node:http").request({ host: "127.0.0.1", port, method: "POST", path: "/api/auth/forgot", headers: { Host: "evil.example", "Content-Type": "application/json" } }, (res) => { res.resume(); res.on("end", resolve); });
      req.on("error", reject);
      req.end(JSON.stringify({ email: REGISTER.email }));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const letter = sent.find((mail) => /Восстановление пароля/.test(mail.subject));
    assert.match(letter.text, /https:\/\/b2b\.styx\.test\/\?reset=/);
    assert.doesNotMatch(letter.text, /evil\.example/);
  }, { appUrl: "https://b2b.styx.test" });
});

test("необычные запросы не роняют сервер: тело null, битая чужая cookie, текст, разрезанный посреди буквы", async () => {
  await withApp(async (browser, { base }) => {
    for (const path of ["/api/auth/login", "/api/auth/register", "/api/auth/forgot"]) {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
      assert.equal(res.status, 400, path);
    }
    assert.equal((await fetch(`${base}/api/session`, { headers: { Cookie: "ym_uid=%E0%A4%A; other=1" } })).status, 200);

    await registerAndApprove(browser);
    const { port } = new URL(base);
    const cookie = browser.cookie;
    const body = Buffer.from(JSON.stringify({ user: { name: "Анна Петрова", email: REGISTER.email, phone: "" } }));
    const cut = body.indexOf(Buffer.from("А")) + 1; // режем внутри двухбайтовой буквы
    await new Promise((resolve, reject) => {
      const req = require("node:http").request({ host: "127.0.0.1", port, method: "PUT", path: "/api/account", headers: { Cookie: cookie, "Content-Type": "application/json", "Content-Length": body.length } }, (res) => { res.resume(); res.on("end", resolve); });
      req.on("error", reject);
      req.write(body.subarray(0, cut));
      setTimeout(() => req.end(body.subarray(cut)), 20);
    });
    assert.equal((await browser.call("GET", "/api/session")).body.user.name, "Анна Петрова");
  });
});

test("неверные настройки почты не роняют сервер: регистрация и заказ проходят, письмо помечено как неотправленное", async () => {
  const broken = { getTransport() { throw new Error("bad SMTP_URL"); } };
  await withApp(async (browser) => {
    const { session } = await registerAndApprove(browser);
    const order = await browser.call("POST", "/api/orders", { companyId: COMPANY.id, delivery: "Самовывоз", items: [{ sku: "15000", qty: 1 }] });
    assert.equal(order.status, 201);
    assert.equal(order.body.mailStatus, "off");
    assert.ok(session);
  }, { brokenTransport: broken });
});

test("юрлицо: реквизиты сохранённого изменить нельзя, о новом юрлице узнаёт менеджер", async () => {
  await withApp(async (browser, { sent }) => {
    await registerAndApprove(browser);
    const changed = await browser.call("PUT", "/api/account", { account: { companies: [{ ...COMPANY, inn: "7702345678" }], activeCompanyId: COMPANY.id } });
    assert.equal(changed.status, 400);
    const second = { id: "company-7705123456", name: "ИП Смирнова", inn: "7705123456", kpp: "", deliveryAddresses: [] };
    const before = sent.length;
    assert.equal((await browser.call("PUT", "/api/account", { account: { companies: [COMPANY, second], activeCompanyId: COMPANY.id } })).status, 200);
    const note = sent.slice(before).find((mail) => /добавил юрлицо/.test(mail.subject));
    assert.ok(note, "менеджеру ушло письмо о новом юрлице");
    assert.match(note.text, /ИНН 7705123456/);
  });
});

test("знак $ в названии организации не портит бланк", async () => {
  const { buildBlank } = require("../server/blanks");
  const { buffer } = await buildBlank("styx-aromaderm.xlsx", { counterparty: "ООО $' Тест $&", lines: [{ sku: "15000", qty: 1 }] });
  const sheet = await (await JSZip.loadAsync(buffer)).file("xl/worksheets/sheet1.xml").async("string");
  assert.match(sheet, /ООО \$' Тест \$&amp;/);
});

test("управляющие символы в названии организации не ломают бланк xlsx", async () => {
  const { buildBlank } = require("../server/blanks");
  const { buffer } = await buildBlank("styx-aromaderm.xlsx", { counterparty: "ООО Ромашка\u0001\u000B", lines: [{ sku: "15000", qty: 1 }] });
  const sheet = await (await JSZip.loadAsync(buffer)).file("xl/worksheets/sheet1.xml").async("string");
  assert.doesNotMatch(sheet, /[\u0001\u000B]/);
  assert.match(sheet, /ООО Ромашка/);
});

test("старые ссылки сброса не работают после смены пароля, смены email и блокировки", async () => {
  await withApp(async (browser, { sent, db }) => {
    const { manager, clientId } = await registerAndApprove(browser);
    const askLink = async (email) => {
      await browser.fork().call("POST", "/api/auth/forgot", { email });
      return sent.filter((mail) => /Восстановление пароля/.test(mail.subject)).at(-1).text.match(/\?reset=([\w-]+)/)[1];
    };
    let token = await askLink(REGISTER.email);
    assert.equal((await browser.call("POST", "/api/account/password", { current: REGISTER.password, password: "changed-pass-1" })).status, 200);
    assert.equal((await browser.fork().call("POST", "/api/auth/reset", { token, password: "attacker-pass" })).status, 400, "после смены пароля");

    token = await askLink(REGISTER.email);
    assert.equal((await browser.call("PUT", "/api/account", { user: { name: "Анна", email: "new@example.ru", phone: "" } })).status, 400, "email без пароля не меняется");
    assert.equal((await browser.call("PUT", "/api/account", { user: { name: "Анна", email: "new@example.ru", phone: "", current: "changed-pass-1" } })).status, 200);
    assert.equal(sent.at(-1).to, REGISTER.email, "прежний адрес получает уведомление");
    assert.equal((await browser.fork().call("POST", "/api/auth/reset", { token, password: "attacker-pass" })).status, 400, "после смены email");

    token = await askLink("new@example.ru");
    assert.equal((await manager.call("POST", `/api/admin/clients/${clientId}/status`, { status: "blocked" })).status, 200);
    assert.equal((await browser.fork().call("POST", "/api/auth/reset", { token, password: "attacker-pass" })).status, 400, "после блокировки");
    assert.ok(db);
  });
});

test("решение менеджера по устаревшему списку не отменяет чужое: 409", async () => {
  await withApp(async (browser) => {
    assert.equal((await browser.call("POST", "/api/auth/register", REGISTER)).status, 201);
    const a = browser.fork();
    const b = browser.fork();
    for (const m of [a, b]) assert.equal((await m.call("POST", "/api/auth/login", { email: "manager@styx.test", password: "manager-pass" })).status, 200);
    const id = (await a.call("GET", "/api/admin/clients")).body.clients[0].id;
    assert.equal((await a.call("POST", `/api/admin/clients/${id}/status`, { status: "blocked", from: "pending" })).status, 200);
    assert.equal((await b.call("POST", `/api/admin/clients/${id}/status`, { status: "active", from: "pending" })).status, 409);
    assert.equal((await b.call("GET", "/api/admin/clients")).body.clients[0].status, "blocked");
  });
});

test("вход: с одного адреса нельзя перебирать много email без ограничения", async () => {
  await withApp(async (browser) => {
    let last = 0;
    for (let i = 0; i < 51; i += 1) last = (await browser.fork().call("POST", "/api/auth/login", { email: `u${i}@example.ru`, password: "x" })).status;
    assert.equal(last, 429);
  });
});

test("create-manager не превращает клиента в менеджера и закрывает сессии при смене пароля", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createManager } = require("../server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "styx-mgr-"));
  const dbPath = path.join(dir, "styx.sqlite");
  const db = openDb(dbPath);
  db.createUser({ email: "client@example.ru", name: "Клиент", passwordHash: hashPassword("client-pass-1"), status: "active" });
  const manager = db.createUser({ email: "boss@styx.test", name: "Мария", passwordHash: hashPassword("manager-pass"), role: "manager", status: "active" });
  db.createSession("h1", manager.id, 60000);
  db.close();
  process.env.MANAGER_PASSWORD = "manager-pass-2";
  try {
    assert.throws(() => createManager({ dbPath }, " Client@Example.ru ", "Новый"), /уже зарегистрирован как клиент/);
    createManager({ dbPath }, "boss@styx.test", "Мария Иванова");
    const check = openDb(dbPath);
    assert.equal(check.userByEmail("client@example.ru").role, "client");
    assert.equal(check.userByEmail("boss@styx.test").name, "Мария Иванова");
    assert.equal(check.sessionUser("h1"), null, "сессии менеджера закрыты");
    check.close();
  } finally {
    delete process.env.MANAGER_PASSWORD;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
