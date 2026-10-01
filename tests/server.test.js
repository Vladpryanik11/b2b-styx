// Тесты HTTP API server.js. Настоящая DaData заменена локальным сервером с тем же форматом ответов:
// это внешняя граница, поэтому подменяем именно её, а не внутренние функции.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServer } = require("../server.js");

const TOKEN = "test-token";
const SECRET = "test-secret";
const seen = [];
let fakeDadata;
let fakeUrl;

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

before(async () => {
  fakeDadata = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const json = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (req.headers.authorization !== `Token ${TOKEN}`) return json(403, {});
      if (req.url === "/party") {
        return json(200, { suggestions: [{
          value: "ПАО СБЕРБАНК",
          data: {
            inn: "7707083893", kpp: "773601001", ogrn: "1027700132195",
            name: { short_with_opf: "ПАО Сбербанк", full_with_opf: "ПАО \"СБЕРБАНК РОССИИ\"" },
            address: { unrestricted_value: "117312, г Москва, ул Вавилова, д 19", value: "г Москва, ул Вавилова, д 19" },
            management: { name: "Не должно уйти в браузер" }
          }
        }] });
      }
      if (req.url === "/address") {
        return json(200, { suggestions: [{ value: "г Москва, ул Сухонская, д 11", unrestricted_value: "127642, г Москва, ул Сухонская, д 11", data: { postal_code: "127642" } }] });
      }
      if (req.url === "/clean") {
        if (req.headers["x-secret"] !== SECRET) return json(401, {});
        const [address] = JSON.parse(body);
        if (address === "сломать") return json(500, {});
        return json(200, [{ source: address, result: "г Москва, ул Сухонская, д 11, кв 89", postal_code: "127642", qc: 0, qc_complete: 0 }]);
      }
      json(404, {});
    });
  });
  fakeUrl = await listen(fakeDadata);
});

after(() => fakeDadata.close());

async function withApp(overrides, run) {
  const cfg = { token: TOKEN, secret: SECRET, partyUrl: `${fakeUrl}/party`, addressUrl: `${fakeUrl}/address`, cleanUrl: `${fakeUrl}/clean`, ...overrides };
  const app = createServer(cfg);
  const base = await listen(app);
  try { await run(base); } finally { app.close(); }
}

const cleanAddress = (base, body) => fetch(`${base}/api/dadata/clean-address`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body)
});

test("поиск Клиента по ИНН возвращает только Реквизиты", async () => {
  await withApp({}, async (base) => {
    const response = await fetch(`${base}/api/dadata/party?query=7707083893`);
    assert.equal(response.status, 200);
    const { suggestions } = await response.json();
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].data.inn, "7707083893");
    assert.equal(suggestions[0].data.kpp, "773601001");
    assert.equal(suggestions[0].data.address.unrestricted_value, "117312, г Москва, ул Вавилова, д 19");
    assert.equal(suggestions[0].data.management, undefined);
  });
});

test("токен DaData уходит только в заголовке запроса к DaData", async () => {
  await withApp({}, async (base) => {
    const response = await fetch(`${base}/api/dadata/party?query=сбербанк`);
    const text = await response.text();
    assert.ok(!text.includes(TOKEN));
    assert.equal(seen.at(-1).headers.authorization, `Token ${TOKEN}`);
  });
});

test("короткий запрос не уходит в DaData", async () => {
  await withApp({}, async (base) => {
    const before = seen.length;
    const response = await fetch(`${base}/api/dadata/party?query=77`);
    assert.deepEqual(await response.json(), { suggestions: [] });
    assert.equal(seen.length, before);
  });
});

test("без токена поиск Клиента отвечает 503, чтобы браузер перешёл на тестовые данные", async () => {
  await withApp({ token: "" }, async (base) => {
    const response = await fetch(`${base}/api/dadata/party?query=7707083893`);
    assert.equal(response.status, 503);
  });
});

test("подсказки Адреса доставки содержат индекс", async () => {
  await withApp({}, async (base) => {
    const response = await fetch(`${base}/api/dadata/address?query=сухонская`);
    const { suggestions } = await response.json();
    assert.deepEqual(suggestions, [{ value: "г Москва, ул Сухонская, д 11", unrestricted_value: "127642, г Москва, ул Сухонская, д 11", postal_code: "127642" }]);
  });
});

test("стандартизация Адреса доставки возвращает адрес с индексом и код качества", async () => {
  await withApp({}, async (base) => {
    const response = await cleanAddress(base, { address: "мск сухонска 11/-89" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.result, "127642, г Москва, ул Сухонская, д 11, кв 89");
    assert.equal(data.qc, 0);
    assert.equal(seen.at(-1).headers["x-secret"], SECRET);
  });
});

test("без секретного ключа стандартизация отвечает 503 и не вызывает DaData", async () => {
  await withApp({ secret: "" }, async (base) => {
    const before = seen.length;
    const response = await cleanAddress(base, { address: "мск сухонска 11/-89" });
    assert.equal(response.status, 503);
    assert.equal(seen.length, before);
  });
});

test("некорректное тело и пустой адрес отклоняются с 400", async () => {
  await withApp({}, async (base) => {
    assert.equal((await cleanAddress(base, "не json")).status, 400);
    assert.equal((await cleanAddress(base, { address: "   " })).status, 400);
  });
});

test("ошибка DaData превращается в 502", async () => {
  await withApp({}, async (base) => {
    assert.equal((await cleanAddress(base, { address: "сломать" })).status, 502);
  });
});

test("сервер отдаёт страницу, но не свои исходники и не .env", async () => {
  await withApp({}, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/..%2FREADME.md`)).status, 404);
  });
});

test("сервер отдаёт шрифт Montserrat с типом font/woff2", async () => {
  await withApp({}, async (base) => {
    const res = await fetch(`${base}/fonts/montserrat-cyrillic.woff2`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "font/woff2");
    assert.equal((await fetch(`${base}/fonts/OFL.txt`)).status, 404);
  });
});
