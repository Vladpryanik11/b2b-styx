// Приём заказа: проверка, пересчёт по каталогу, деление по юрлицам STYX и письмо с бланками.
// Для клиента это один заказ и одна сумма. Внутри STYX заказ делится на два бланка:
// позиции из бланка «Aromaderm 1000» (литровая и 400-мл фасовка) — в счёт Санкт-Петербурга,
// всё остальное — в счёт Москвы (правило подтвердил заказчик 01.10.2026).
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildBlank, loadTemplate, skuKey } = require("./blanks");

// Промокоды дублируют PROMO_CODES из app.js: сервер не доверяет скидке, присланной браузером.
const PROMO_CODES = { XSIZE: 10, LANDGROUP: 10 };
const PICKUP_ADDRESS = "г. Москва, ул. Сущевская, д. 23";

const ENTITIES = [
  {
    id: "spb",
    title: "Санкт-Петербург",
    template: "aromaderm-1000.xlsx",
    fileName: (number) => `${number} бланк Aromaderm 1000 (Санкт-Петербург).xlsx`
  },
  {
    id: "msk",
    title: "Москва",
    template: "styx-aromaderm.xlsx",
    fileName: (number) => `${number} бланк STYX Aromaderm (Москва).xlsx`
  }
];

function loadCatalog(file = path.join(__dirname, "..", "catalog.js")) {
  const context = vm.createContext({});
  const { CATALOG } = vm.runInContext(`${fs.readFileSync(file, "utf8")}\n;({ CATALOG })`, context);
  const bySku = new Map();
  CATALOG.forEach((product) => product.variants.forEach((variant) => {
    bySku.set(skuKey(variant.sku), { sku: variant.sku, name: `${product.name} ${variant.volume}`.trim(), productName: product.name, volume: variant.volume, price: variant.price });
  }));
  return bySku;
}

// Артикулы бланка Питера: всё, что в нём есть, уходит в счёт Питера.
async function spbSkus() {
  return new Set((await loadTemplate(ENTITIES[0].template)).items.keys());
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * Проверяет заказ и пересчитывает цены и скидку по каталогу сервера.
 * company и contact сервер подставляет сам из учётной записи; номер и дату назначает база (необязательны).
 */
function normalizeOrder(raw, catalog) {
  const errors = [];
  const order = {
    number: text(raw?.number, 40),
    date: text(raw?.date, 20),
    company: {
      name: text(raw?.company?.name, 300),
      inn: text(raw?.company?.inn, 12),
      kpp: text(raw?.company?.kpp, 9),
      address: text(raw?.company?.address, 500)
    },
    contact: {
      name: text(raw?.contact?.name, 200),
      email: text(raw?.contact?.email, 200),
      phone: text(raw?.contact?.phone, 50)
    },
    delivery: raw?.delivery === "Самовывоз" ? "Самовывоз" : "Доставка",
    address: text(raw?.address, 500),
    comment: text(raw?.comment, 500)
  };
  if (order.number && !/^[\w-]{1,40}$/.test(order.number)) errors.push("Неверный номер заказа");
  if (!order.company.name || !/^\d{10}(\d{2})?$/.test(order.company.inn)) errors.push("Нет названия или ИНН организации");
  if (order.delivery === "Самовывоз") order.address = PICKUP_ADDRESS;
  else if (!order.address) errors.push("Нет адреса доставки");

  const quantities = new Map();
  (Array.isArray(raw?.items) ? raw.items : []).slice(0, 500).forEach((item) => {
    const key = skuKey(item?.sku);
    const qty = Number(item?.qty);
    if (!catalog.has(key)) return errors.push(`Нет в каталоге: ${String(item?.sku).slice(0, 20)}`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return errors.push(`Неверное количество для ${catalog.get(key).sku}`);
    quantities.set(key, (quantities.get(key) || 0) + qty);
  });
  if (!quantities.size && !errors.length) errors.push("В заказе нет товаров");
  order.lines = [...quantities].map(([key, qty]) => ({ ...catalog.get(key), qty }));
  order.subtotal = order.lines.reduce((sum, line) => sum + line.price * line.qty, 0);

  const promo = text(raw?.promoCode, 40).toUpperCase();
  if (promo && !PROMO_CODES[promo]) errors.push("Промокод не найден");
  order.promoCode = PROMO_CODES[promo] ? promo : "";
  order.discountPercent = PROMO_CODES[promo] || 0;
  order.discount = Math.round(order.subtotal * order.discountPercent / 100);
  order.total = order.subtotal - order.discount;
  return { order, errors };
}

/** Делит заказ на части по юрлицам. Скидка делится так, чтобы сумма частей точно совпала с заказом. */
async function splitOrder(order) {
  const spb = await spbSkus();
  const parts = ENTITIES
    .map((entity) => {
      const lines = order.lines.filter((line) => (spb.has(skuKey(line.sku)) ? "spb" : "msk") === entity.id);
      const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
      return { entity, lines, subtotal, discount: 0, total: subtotal };
    })
    .filter((part) => part.lines.length);
  let discountLeft = order.discount;
  parts.forEach((part, index) => {
    part.discount = index === parts.length - 1 ? discountLeft : Math.round(part.subtotal * order.discountPercent / 100);
    discountLeft -= part.discount;
    part.total = part.subtotal - part.discount;
  });
  return parts;
}

const rub = (value) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

function requisitesLine(order) {
  const { inn, kpp } = order.company;
  return `ИНН ${inn}${kpp && kpp !== "—" ? `, КПП ${kpp}` : ""}`;
}

/** Бланки остаются как есть: заполняются только «Контрагент» и количества. Всё остальное о заказе — в письме. */
async function buildOrderBlanks(order) {
  const parts = await splitOrder(order);
  return Promise.all(parts.map(async (part) => {
    const { buffer, missing } = await buildBlank(part.entity.template, {
      counterparty: order.company.name,
      lines: part.lines
    });
    return { part, missing, filename: part.entity.fileName(order.number), content: buffer };
  }));
}

function managerMessage(order, blanks) {
  const { company, contact } = order;
  const lines = [
    `Новый заказ ${order.number} от ${order.date}`,
    "",
    "Юрлицо клиента:",
    company.name,
    requisitesLine(order),
    company.address ? `Юридический адрес: ${company.address}` : null,
    "",
    "Контакт:",
    ...[contact.name, contact.phone, contact.email].filter(Boolean),
    "",
    order.delivery === "Самовывоз" ? `Получение: самовывоз, ${order.address}` : `Получение: доставка`,
    order.delivery === "Самовывоз" ? null : `Адрес доставки: ${order.address}`,
    order.comment ? `Комментарий: ${order.comment}` : null,
    "",
    `Сумма заказа: ${rub(order.subtotal)}`,
    order.discount ? `Промокод ${order.promoCode}: скидка ${order.discountPercent}% = ${rub(order.discount)}` : null,
    `Итого к оплате: ${rub(order.total)}`,
    "",
    `Для клиента это один заказ. Счета по юрлицам STYX (${blanks.length}):`,
    ...blanks.flatMap(({ part, filename, missing }) => [
      "",
      `${part.entity.title}: ${rub(part.subtotal)}${part.discount ? `, скидка ${rub(part.discount)}, к оплате ${rub(part.total)}` : ""}`,
      `Бланк: ${filename}`,
      ...part.lines.map((line) => `- ${line.sku} ${line.name}: ${line.qty} шт. × ${rub(line.price)}`),
      ...(missing.length ? [`Нет в бланке, добавьте в счёт вручную: ${missing.map((line) => `${line.sku} ${line.name} — ${line.qty} шт.`).join("; ")}`] : [])
    ])
  ];
  return {
    subject: `Заказ ${order.number}: ${company.name}, ${blanks.length === 1 ? "1 бланк" : `${blanks.length} бланка`}`,
    text: lines.filter((line) => line !== null).join("\n"),
    attachments: blanks.map(({ filename, content }) => ({
      filename,
      content,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }))
  };
}

function clientMessage(order) {
  const lines = [
    `Здравствуйте${order.contact.name ? `, ${order.contact.name}` : ""}!`,
    "",
    `Мы получили ваш заказ ${order.number} от ${order.date} для ${order.company.name}.`,
    "",
    ...order.lines.map((line) => `- ${line.sku} ${line.name}: ${line.qty} шт. × ${rub(line.price)}`),
    "",
    order.discount ? `Сумма: ${rub(order.subtotal)}, скидка по промокоду ${order.promoCode}: ${rub(order.discount)}` : null,
    `Итого: ${rub(order.total)}`,
    order.delivery === "Самовывоз" ? `Самовывоз: ${order.address}` : `Доставка: ${order.address}`,
    "",
    "Менеджер STYX свяжется с вами и пришлёт счета на оплату."
  ];
  return { subject: `Ваш заказ ${order.number} принят`, text: lines.filter((line) => line !== null).join("\n") };
}

module.exports = { ENTITIES, PROMO_CODES, loadCatalog, normalizeOrder, splitOrder, buildOrderBlanks, managerMessage, clientMessage };
