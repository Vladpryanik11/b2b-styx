// Тесты отправки заказа: POST /api/orders делит заказ по юрлицам и отправляет письмо с бланками Excel.
// Почтовый сервер — внешняя граница, поэтому подменяем транспорт: он только запоминает письма.
// Клиент с юрлицом и сессией создаётся прямо в базе в памяти; вход и регистрация проверяются в api.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const { createServer } = require("../server.js");
const { splitOrder, normalizeOrder, loadCatalog } = require("../server/orders");
const { openDb } = require("../server/db");
const { hashPassword, newToken } = require("../server/auth");

const MAIL = { to: "orders@styx.test", from: "cabinet@styx.test", clientCopy: true };

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

const COMPANY = { id: "company-7701234567", name: "ООО «Северный Стикс»", inn: "7701234567", kpp: "770101001", address: "г. Москва, ул. Правды, д. 8", deliveryAddresses: [] };

async function withApp(cfg, run) {
  const sent = [];
  const transport = { async sendMail(message) { sent.push(message); return { messageId: "test" }; } };
  const db = openDb(":memory:");
  const user = db.createUser({ email: "anna@example.ru", name: "Анна", phone: "+7 900 000-00-00", passwordHash: hashPassword("strong-pass-1"), status: "active", profile: { companies: [COMPANY], activeCompanyId: COMPANY.id } });
  const { token, hash } = newToken();
  db.createSession(hash, user.id, 60 * 60 * 1000);
  const app = createServer({ token: "", secret: "", ...cfg }, { db, transport });
  const base = await listen(app);
  const post = (body) => fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `styx_session=${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  try { await run(post, sent); } finally { app.close(); }
}

const ORDER = {
  companyId: COMPANY.id,
  delivery: "Доставка",
  address: "г. Москва, ул. Лесная, д. 5",
  comment: "Позвонить заранее",
  items: [{ sku: "82014", qty: 3 }, { sku: "15000", qty: 5 }, { sku: "81016", qty: 2 }, { sku: "40125", qty: 1 }],
  promoCode: "xsize"
};

// Читает из бланка заполненные количества (колонка E) и ячейку «Контрагент».
async function readBlank(content) {
  const zip = await JSZip.loadAsync(content);
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const qty = [...sheet.matchAll(/<c r="E(\d+)"[^>]*t="n"><v>(\d+)<\/v><\/c>/g)].map(([, row, value]) => [Number(row), Number(value)]);
  const sku = (row) => sheet.match(new RegExp(`<c r="B${row}"[^>]*><v>([^<]*)</v>`))?.[1];
  return { zip, sheet, ordered: qty.map(([row, value]) => [sku(row), value]), counterparty: (sheet.match(/t="inlineStr"><is>([\s\S]*?)<\/is>/)?.[1] || "").replace(/<[^>]+>/g, "").trim() };
}

test("один заказ клиента: письмо менеджеру с двумя бланками по юрлицам и подтверждение клиенту", async () => {
  await withApp({ mail: MAIL }, async (postOrder, sent) => {
    const response = await postOrder(ORDER);
    assert.equal(response.status, 201);
    const body = await response.json();
    // 3172*3 + 976*5 + 14152*2 + 5124 = 47 824, скидка 10% = 4 782
    assert.equal(body.order.total, 47824 - 4782);
    assert.equal(body.mailStatus, "sent");

    assert.equal(sent.length, 2);
    const [manager, client] = sent;
    assert.equal(manager.to, MAIL.to);
    assert.equal(manager.replyTo, "anna@example.ru");
    assert.deepEqual(manager.attachments.map((file) => /Санкт-Петербург/.test(file.filename) ? "spb" : /Москва/.test(file.filename) ? "msk" : file.filename), ["spb", "msk"]);
    assert.match(manager.text, /Итого к оплате: 43\s042 ₽/);
    assert.equal(client.to, "anna@example.ru");
    assert.equal(client.attachments, undefined, "клиенту бланки не уходят — для него это один заказ");

    const spb = await readBlank(manager.attachments[0].content);
    assert.match(spb.sheet, /<autoFilter ref="A6:E28"/, "фильтр пустых позиций есть и в бланке Питера");
    assert.deepEqual(spb.ordered, [["81016", 2], ["40125", 1]]);
    const msk = await readBlank(manager.attachments[1].content);
    assert.deepEqual(msk.ordered, [["82014", 3], ["15000", 5]]);
    assert.match(msk.counterparty, /^Контрагент\s+ООО «Северный Стикс»$/);
    assert.match(msk.sheet, /<f aca="false">SUMPRODUCT\(D9:D288,E9:E288\)<\/f><v>14396<\/v>/, "формула суммы на месте");
    assert.match(manager.text, /ИНН 7701234567, КПП 770101001/);
    assert.match(manager.text, /Адрес доставки: г\. Москва, ул\. Лесная, д\. 5/);
  });
});

test("заказ только из общего бланка уходит одним бланком Москвы", async () => {
  await withApp({ mail: MAIL }, async (postOrder, sent) => {
    const response = await postOrder({ ...ORDER, items: [{ sku: "15000", qty: 1 }], promoCode: "" });
    assert.equal(response.status, 201);
    assert.equal(sent[0].attachments.length, 1);
    assert.match(sent[0].attachments[0].filename, /Москва/);
  });
});

test("бланк не меняется: кроме количеств и «Контрагента» файл совпадает с оригиналом", async () => {
  await withApp({ mail: MAIL }, async (postOrder, sent) => {
    assert.equal((await postOrder({ ...ORDER, items: [{ sku: "15000", qty: 5 }] })).status, 201);
    const original = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, "..", "blanks", "styx-aromaderm.xlsx")));
    const filled = await JSZip.loadAsync(sent[0].attachments[0].content);
    assert.deepEqual(Object.keys(filled.files).sort(), Object.keys(original.files).sort());
    for (const name of Object.keys(original.files)) {
      if (original.files[name].dir || name === "xl/worksheets/sheet1.xml" || name === "xl/workbook.xml") continue;
      assert.ok((await filled.file(name).async("nodebuffer")).equals(await original.file(name).async("nodebuffer")), name);
    }
    const strip = (xml) => xml.replace(/<c r="(E\d+|C5)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, "").replace(/(SUMPRODUCT[^<]*<\/f>)<v>[^<]*<\/v>/, "$1");
    const sheetBefore = await original.file("xl/worksheets/sheet1.xml").async("string");
    const sheetAfter = await filled.file("xl/worksheets/sheet1.xml").async("string");
    assert.equal(strip(sheetAfter), strip(sheetBefore));
    assert.match(sheetAfter, /<autoFilter ref="A8:E288"/);
  });
});

test("позиция, которой нет в бланке, не дописывается в бланк, а указывается в письме", async () => {
  await withApp({ mail: MAIL }, async (postOrder, sent) => {
    assert.equal((await postOrder({ ...ORDER, items: [{ sku: "4***", qty: 2 }, { sku: "15000", qty: 1 }] })).status, 201);
    const { ordered } = await readBlank(sent[0].attachments[0].content);
    assert.deepEqual(ordered, [["15000", 1]]);
    assert.match(sent[0].text, /Нет в бланке, добавьте в счёт вручную: 4\*\*\* .* — 2 шт\./);
  });
});

test("сервер не принимает чужие артикулы, неверное количество и неизвестный промокод", async () => {
  await withApp({ mail: MAIL }, async (postOrder, sent) => {
    assert.equal((await postOrder({ ...ORDER, items: [{ sku: "000000", qty: 1 }] })).status, 400);
    assert.equal((await postOrder({ ...ORDER, items: [{ sku: "15000", qty: 0 }] })).status, 400);
    assert.equal((await postOrder({ ...ORDER, promoCode: "FREE100" })).status, 400);
    assert.equal((await postOrder({ ...ORDER, companyId: "company-0000000000" })).status, 400);
    assert.equal((await postOrder("не json")).status, 400);
    assert.equal(sent.length, 0);
  });
});

test("цена берётся из каталога сервера, а скидка делится по бланкам без потери рубля", async () => {
  const { order } = normalizeOrder({ ...ORDER, company: COMPANY, items: [...ORDER.items, { sku: "15320", qty: 1, price: 1 }] }, loadCatalog());
  assert.equal(order.lines.find((line) => line.sku === "15320").price, 915);
  const parts = await splitOrder(order);
  assert.equal(parts.reduce((sum, part) => sum + part.discount, 0), order.discount);
  assert.equal(parts.reduce((sum, part) => sum + part.total, 0), order.total);
});

test("самовывоз подставляет адрес склада на Сущевской", () => {
  const { order, errors } = normalizeOrder({ ...ORDER, company: COMPANY, delivery: "Самовывоз", address: "" }, loadCatalog());
  assert.deepEqual(errors, []);
  assert.equal(order.address, "г. Москва, ул. Сущевская, д. 23");
});

test("лимит количества — на итог артикула, а номер заказа из запроса не учитывается", async () => {
  await withApp({ mail: MAIL }, async (postOrder) => {
    assert.equal((await postOrder({ ...ORDER, items: [{ sku: "82019", qty: 999 }, { sku: "82019", qty: 999 }] })).status, 400);
    assert.equal((await postOrder({ ...ORDER, number: "№ 5" })).status, 201);
  });
});

test("товар не в наличии сервер не принимает", () => {
  const catalog = loadCatalog();
  const key = [...catalog.keys()][0];
  catalog.set(key, { ...catalog.get(key), inStock: false });
  const { errors } = normalizeOrder({ ...ORDER, company: COMPANY, items: [{ sku: catalog.get(key).sku, qty: 1 }] }, catalog);
  assert.match(errors.join(" "), /Нет в наличии/);
});

test("если цена в бланке отличается от прайса, письмо менеджеру об этом говорит", async () => {
  const { buildOrderBlanks, managerMessage } = require("../server/orders");
  const { order } = normalizeOrder({ ...ORDER, company: COMPANY, items: [{ sku: "99916", qty: 1 }] }, loadCatalog());
  order.number = "STYX-00001";
  const { text } = managerMessage(order, await buildOrderBlanks(order));
  assert.match(text, /Цены в бланке отличаются от прайса: 99916 — в бланке 427 ₽, в прайсе 490 ₽/);
});
