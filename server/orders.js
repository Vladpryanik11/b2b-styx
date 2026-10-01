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
    form: {
      template: "aromaderm-1000.json",
      logos: [
        { file: "styx-logo.png", tl: { col: 0.2, row: 0.15 }, width: 160, height: 55 },
        { file: "aromaderm-logo.png", tl: { col: 3.15, row: 0.1 }, width: 68, height: 56 }
      ]
    },
    fileName: (number) => `${number} бланк Aromaderm 1000 (Санкт-Петербург).xlsx`
  },
  {
    id: "msk",
    title: "Москва",
    form: {
      template: "styx-aromaderm.json",
      autoFilter: true,
      logos: [
        { file: "styx-logo.png", tl: { col: 0.2, row: 0.15 }, width: 160, height: 55 },
        { file: "aromaderm-logo.png", tl: { col: 3.15, row: 0.1 }, width: 68, height: 56 }
      ]
    },
    fileName: (number) => `${number} бланк STYX Aromaderm (Москва).xlsx`
  }
];

function loadCatalog(file = path.join(__dirname, "..", "catalog.js")) {
  const context = vm.createContext({});
  const { CATALOG } = vm.runInContext(`${fs.readFileSync(file, "utf8")}\n;({ CATALOG })`, context);
  const bySku = new Map();
  CATALOG.forEach((product) => product.variants.forEach((variant) => {
    bySku.set(skuKey(variant.sku), { sku: variant.sku, name: `${product.name} ${variant.volume}`.trim(), price: variant.price });
  }));
  return bySku;
}

// Артикулы бланка Питера: всё, что в нём есть, уходит в счёт Питера.
function spbSkus() {
  return new Set(loadTemplate(ENTITIES[0].form.template).items.keys());
}

function entityFor(sku, spb = spbSkus()) {
  return spb.has(skuKey(sku)) ? "spb" : "msk";
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Проверяет заказ из браузера и пересчитывает цены и скидку по каталогу сервера. */
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
  if (!/^[\w-]{1,40}$/.test(order.number)) errors.push("Неверный номер заказа");
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
function splitOrder(order) {
  const spb = spbSkus();
  const parts = ENTITIES
    .map((entity) => {
      const lines = order.lines.filter((line) => entityFor(line.sku, spb) === entity.id);
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

function counterpartyLine(order) {
  return `Контрагент: ${order.company.name}, ${requisitesLine(order)}`;
}

function blankInfo(order, part, partIndex, partCount) {
  const contact = [order.contact.name, order.contact.phone, order.contact.email].filter(Boolean).join(", ");
  const info = [
    { text: `Заказ ${order.number} от ${order.date}${partCount > 1 ? `, бланк ${partIndex + 1} из ${partCount}` : ""} (${part.entity.title})`, bold: true },
    { text: `${order.company.name}, ${requisitesLine(order)}` },
    contact && { text: `Контакт: ${contact}` },
    { text: order.delivery === "Самовывоз" ? `Самовывоз: ${order.address}` : `Доставка: ${order.address}` },
    order.comment && { text: `Комментарий: ${order.comment}` },
    order.discount && { text: `Промокод ${order.promoCode}: скидка ${order.discountPercent}% = ${rub(part.discount)}. Итого по бланку со скидкой: ${rub(part.total)}`, bold: true }
  ];
  return info.filter(Boolean);
}

async function buildOrderBlanks(order, parts = splitOrder(order)) {
  return Promise.all(parts.map(async (part, index) => {
    const { buffer } = await buildBlank(part.entity.form, {
      counterparty: `Контрагент: ${order.company.name}`,
      info: blankInfo(order, part, index, parts.length),
      lines: part.lines
    });
    return { part, filename: part.entity.fileName(order.number), content: buffer };
  }));
}

function managerMessage(order, blanks) {
  const lines = [
    `Новый заказ ${order.number} от ${order.date}`,
    counterpartyLine(order),
    order.contact.name || order.contact.email ? `Контакт: ${[order.contact.name, order.contact.phone, order.contact.email].filter(Boolean).join(", ")}` : null,
    order.delivery === "Самовывоз" ? `Самовывоз: ${order.address}` : `Доставка: ${order.address}`,
    order.comment ? `Комментарий: ${order.comment}` : null,
    "",
    `Для клиента это один заказ на ${rub(order.total)}${order.discount ? ` (промокод ${order.promoCode}, скидка ${order.discountPercent}% = ${rub(order.discount)})` : ""}.`,
    `Счета по юрлицам (${blanks.length}):`,
    ...blanks.map(({ part, filename }) => `- ${part.entity.title}: ${part.lines.length} поз., ${rub(part.total)}. Бланк: ${filename}`)
  ];
  return {
    subject: `Заказ ${order.number}: ${order.company.name}, ${blanks.length === 1 ? "1 бланк" : `${blanks.length} бланка`}`,
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

module.exports = { ENTITIES, PROMO_CODES, loadCatalog, entityFor, normalizeOrder, splitOrder, buildOrderBlanks, managerMessage, clientMessage };
