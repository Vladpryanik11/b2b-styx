// Тесты отправки заказа: POST /api/orders делит заказ по юрлицам и отправляет письмо с бланками Excel.
// Почтовый сервер — внешняя граница, поэтому подменяем транспорт: он только запоминает письма.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { createServer } = require("../server.js");
const { splitOrder, normalizeOrder, loadCatalog } = require("../server/orders");

const MAIL = { to: "orders@styx.test", from: "cabinet@styx.test", clientCopy: true };

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function withApp(cfg, run) {
  const sent = [];
  const transport = { async sendMail(message) { sent.push(message); return { messageId: "test" }; } };
  const app = createServer({ token: "", secret: "", ...cfg }, { transport: cfg.noTransport ? null : transport });
  const base = await listen(app);
  try { await run(base, sent); } finally { app.close(); }
}

const ORDER = {
  number: "STYX-00042",
  date: "01.10.2026",
  company: { name: "ООО «Северный Стикс»", inn: "7701234567", kpp: "770101001" },
  contact: { name: "Анна", email: "anna@example.ru", phone: "+7 900 000-00-00" },
  delivery: "Доставка",
  address: "г. Москва, ул. Лесная, д. 5",
  comment: "Позвонить заранее",
  items: [{ sku: "82014", qty: 3 }, { sku: "15000", qty: 5 }, { sku: "81016", qty: 2 }, { sku: "40125", qty: 1 }],
  promoCode: "xsize"
};

const postOrder = (base, body) => fetch(`${base}/api/orders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body)
});

async function readBlank(content) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content);
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow((row, number) => rows.push({ number, values: row.values.slice(1).map((value) => value?.result ?? value?.text ?? value) }));
  return { sheet, rows };
}

test("без настроенной почты заказ отвечает 503, письмо не уходит", async () => {
  await withApp({ mail: {}, noTransport: true }, async (base) => {
    assert.equal((await postOrder(base, ORDER)).status, 503);
  });
});

test("один заказ клиента: письмо менеджеру с двумя бланками по юрлицам и подтверждение клиенту", async () => {
  await withApp({ mail: MAIL }, async (base, sent) => {
    const response = await postOrder(base, ORDER);
    assert.equal(response.status, 200);
    const body = await response.json();
    // 3172*3 + 976*5 + 14152*2 + 5124 = 47 824, скидка 10% = 4 782
    assert.equal(body.total, 47824 - 4782);
    assert.deepEqual(body.blanks.map((blank) => blank.entity), ["Санкт-Петербург", "Москва"]);
    assert.equal(body.blanks.reduce((sum, blank) => sum + blank.total, 0), body.total);
    assert.equal(body.clientNotified, true);

    assert.equal(sent.length, 2);
    const [manager, client] = sent;
    assert.equal(manager.to, MAIL.to);
    assert.equal(manager.replyTo, "anna@example.ru");
    assert.equal(manager.attachments.length, 2);
    assert.match(manager.text, /один заказ на 43\s042 ₽/);
    assert.equal(client.to, "anna@example.ru");
    assert.equal(client.attachments, undefined, "клиенту бланки не уходят — для него это один заказ");

    const spb = await readBlank(manager.attachments[0].content);
    const ordered = (rows) => rows.filter((row) => typeof row.values[4] === "number" && row.number > 11).map((row) => [String(row.values[1]), row.values[4]]);
    assert.deepEqual(ordered(spb.rows), [["81016", 2], ["40125", 1]]);
    const msk = await readBlank(manager.attachments[1].content);
    assert.deepEqual(ordered(msk.rows), [["82014", 3], ["15000", 5]]);
    const header = msk.rows.find((row) => String(row.values[2]).startsWith("Контрагент"));
    assert.equal(header.values[2], "Контрагент: ООО «Северный Стикс»");
    assert.ok(msk.rows.some((row) => row.values[2] === "ООО «Северный Стикс», ИНН 7701234567, КПП 770101001"));
    assert.equal(header.values[4], 3172 * 3 + 976 * 5);
  });
});

test("заказ только из общего бланка уходит одним бланком Москвы", async () => {
  await withApp({ mail: MAIL }, async (base, sent) => {
    const response = await postOrder(base, { ...ORDER, items: [{ sku: "15000", qty: 1 }], promoCode: "" });
    assert.equal(response.status, 200);
    assert.equal(sent[0].attachments.length, 1);
    assert.match(sent[0].attachments[0].filename, /Москва/);
  });
});

test("позиции не из бланка дописываются в конец бланка, а не теряются", async () => {
  await withApp({ mail: MAIL }, async (base, sent) => {
    assert.equal((await postOrder(base, { ...ORDER, items: [{ sku: "4***", qty: 2 }] })).status, 200);
    const { rows } = await readBlank(sent[0].attachments[0].content);
    const last = rows.at(-1).values;
    assert.equal(last[1], "4***");
    assert.equal(last[4], 2);
  });
});

test("сервер не принимает чужие артикулы, неверное количество и неизвестный промокод", async () => {
  await withApp({ mail: MAIL }, async (base, sent) => {
    assert.equal((await postOrder(base, { ...ORDER, items: [{ sku: "000000", qty: 1 }] })).status, 400);
    assert.equal((await postOrder(base, { ...ORDER, items: [{ sku: "15000", qty: 0 }] })).status, 400);
    assert.equal((await postOrder(base, { ...ORDER, promoCode: "FREE100" })).status, 400);
    assert.equal((await postOrder(base, { ...ORDER, company: { name: "ООО", inn: "123" } })).status, 400);
    assert.equal((await postOrder(base, "не json")).status, 400);
    assert.equal(sent.length, 0);
  });
});

test("цена берётся из каталога сервера, а скидка делится по бланкам без потери рубля", () => {
  const { order } = normalizeOrder({ ...ORDER, items: [...ORDER.items, { sku: "15320", qty: 1, price: 1 }] }, loadCatalog());
  assert.equal(order.lines.find((line) => line.sku === "15320").price, 915);
  const parts = splitOrder(order);
  assert.equal(parts.reduce((sum, part) => sum + part.discount, 0), order.discount);
  assert.equal(parts.reduce((sum, part) => sum + part.total, 0), order.total);
});

test("самовывоз подставляет адрес склада на Сущевской", () => {
  const { order, errors } = normalizeOrder({ ...ORDER, delivery: "Самовывоз", address: "" }, loadCatalog());
  assert.deepEqual(errors, []);
  assert.equal(order.address, "г. Москва, ул. Сущевская, д. 23");
});
